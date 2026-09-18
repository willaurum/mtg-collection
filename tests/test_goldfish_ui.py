"""Desktop interaction regression checks. Requires Playwright + Chromium.
Run: python tests/test_goldfish_ui.py
Uses real template, CSS, and tester JS with an isolated deck; no server or account.
"""
from pathlib import Path
import tempfile

def main():
    from playwright.sync_api import sync_playwright

    ROOT = Path(__file__).resolve().parents[1]
    html = (ROOT / "templates/index.html").read_text(encoding="utf-8")
    html = html[html.index('<div class="deck-export-overlay" id="goldfishDialog"'):html.index('<div class="card-detail-overlay"')]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_content(html)
        page.add_style_tag(content=(ROOT / "static/style.css").read_text(encoding="utf-8"))
        page.add_script_tag(content="""
          const el = id => document.getElementById(id);
          const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
          const imageUrl = () => null;
          const deck = {id: 1, name: 'Tabletop test', commander_id: 'commander', cards: [
            {card_id:'commander', zone:'main', quantity:1, card:{name:'Commander'}},
            {card_id:'card', zone:'main', quantity:30, card:{name:'Test card', card_faces:[{name:'Front'}, {name:'Back'}]}}
          ]};
          const state = {deckId: 1};
          const deckById = () => deck;
        """)
        for name in ["goldfish.js", "goldfish-ui.js"]:
            page.add_script_tag(content=(ROOT / "static" / name).read_text(encoding="utf-8"))
        page.evaluate("el('goldfishDialog').hidden = false; startPractice(deck)")
        def game(expression):
            return page.evaluate("(() => { const {cards, zones} = practiceSession.game; return practiceSession.game." + expression + "; })()")
        def drag(selector, x, y):
            box = page.locator(selector).bounding_box()
            page.mouse.move(box['x'] + 20, box['y'] + 20)
            page.mouse.down()
            page.mouse.move(x, y, steps=8)
            page.mouse.up()
        field = page.locator('#practiceBattlefield').bounding_box()
        first = game('zones.hand[0]')
        drag(f'#goldfishHand [data-card="{first}"]', field['x'] + 143, field['y'] + 107)
        assert game(f'cards["{first}"].x') == 123
        assert game(f'cards["{first}"].y') == 87
        page.locator(f'#practiceBattlefield [data-card="{first}"]').dblclick()
        assert game(f'cards["{first}"].tapped')
        page.locator('#practiceCounterName').fill('+1/+1')
        page.locator('[data-card-action="counter"][data-delta="1"]').click()
        drag(f'#practiceBattlefield [data-card="{first}"]', field['x'] + 250, field['y'] + 170)
        assert game(f'cards["{first}"].x') == 230
        assert game(f'cards["{first}"].tapped')
        assert game(f'cards["{first}"].namedCounters["+1/+1"]') == 1
        second = game('zones.hand[0]')
        drag(f'#goldfishHand [data-card="{second}"]', field['x'] + 440, field['y'] + 170)
        page.locator(f'#practiceBattlefield [data-card="{first}"]').click(modifiers=['Control'])
        assert page.evaluate('practiceSelected.size') == 2
        before = game('zones.battlefield.map(id => [id, cards[id].x, cards[id].y])')
        drag(f'#practiceBattlefield [data-card="{second}"]', field['x'] + 500, field['y'] + 230)
        assert game(f'cards["{first}"].x') == before[0][1] + 60
        assert game(f'cards["{second}"].x') == before[1][1] + 60
        page.locator('#practiceUndo').click()
        assert game(f'cards["{first}"].x') == before[0][1]
        assert game(f'cards["{second}"].x') == before[1][1]
        hand_count = game('zones.hand.length')
        page.locator('[data-practice="turn"]').click()
        assert game('turn') == 2
        assert game('zones.hand.length') == hand_count + 1
        assert not game(f'cards["{first}"].tapped')
        # Area selection selects both permanents.
        page.mouse.move(field['x'] + 200, field['y'] + 100)
        page.mouse.down()
        page.mouse.move(field['x'] + 570, field['y'] + 330, steps=8)
        page.mouse.up()
        assert page.evaluate('practiceSelected.size') == 2
        # A group drop into a zone moves both cards and clears counters.
        grave = page.locator('[data-drop-zone="graveyard"]').bounding_box()
        drag(f'#practiceBattlefield [data-card="{second}"]', grave['x'] + 30, grave['y'] + 25)
        assert game('zones.graveyard.length') == 2
        assert game('zones.battlefield.length') == 0
        assert game(f'cards["{first}"].namedCounters') == {}
        page.locator('[data-zone="library"]').first.click()
        page.locator('#practiceSearch').fill('no match')
        assert page.locator('#practiceBrowserCards [data-card]').count() == 0
        page.locator('#practiceSearch').fill('Test card')
        top = game('zones.library[0]')
        drag(f'#practiceBrowserCards [data-card="{top}"]', field['x'] + 500, field['y'] + 50)
        assert top in game('zones.battlefield')
        page.locator('#practiceBrowserClose').click()
        # Typing shortcuts in an input must not draw cards.
        count = game('zones.hand.length')
        page.locator('#practiceTokenName').fill('')
        page.locator('#practiceTokenName').press('d')
        assert game('zones.hand.length') == count
        page.locator('#practiceTokenName').fill('1/1 Soldier')
        page.locator('#practiceTokenForm button').click()
        token = game('zones.battlefield.at(-1)')
        assert game(f'cards["{token}"].token')
        page.locator('[data-practice="untap"]').focus()
        page.keyboard.press('d')
        assert game('zones.hand.length') == count + 1
        # Exercise face switching, token copy, and library-bottom movement.
        page.locator(f'#practiceBattlefield [data-card="{top}"]').click()
        page.locator('[data-card-action="flip"]').click()
        assert game(f'cards["{top}"].face') == 1
        page.locator('[data-card-action="copy"]').click()
        assert game('cards[zones.battlefield.at(-1)].token')
        page.locator('#practiceDestination').select_option('library:bottom')
        page.locator('[data-card-action="move"]').click()
        assert game('zones.library.at(-1)') == top
        page.evaluate('stopPractice(); startPractice(deck)')
        assert game('turn') == 1
        assert game('zones.hand.length') == 7
        assert game('zones.battlefield.length') == 0
        assert page.evaluate('practiceSession.history.length') == 0
        # Re-populate for visual layout inspection.
        page.evaluate("practiceAction({type:'move', id:practiceSession.game.zones.hand[0], zone:'battlefield', x:180, y:90})")
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'mtg-tabletop-preview.png'))
        page.set_viewport_size({'width': 1280, 'height': 720})
        assert page.locator('#practiceDraw').is_visible()
        assert page.locator('#goldfishHand').bounding_box()['y'] < 720
        assert page.locator('#practiceBattlefield').bounding_box()['width'] == page.locator('#practiceFieldScroll').evaluate('n => n.clientWidth')
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'mtg-tabletop-desktop.png'))
        # Right-click selects the target and exposes the same card actions.
        target = game('zones.battlefield[0]')
        target_node = page.locator(f'#practiceBattlefield [data-card="{target}"]')
        target_node.click(button='right')
        menu = page.locator('#practiceContextMenu')
        assert menu.is_visible()
        menu.locator('[data-card-action="tap"]').click()
        assert game(f'cards["{target}"].tapped')
        assert menu.count() == 0
        assert target_node.evaluate('n => getComputedStyle(n).backgroundColor') == 'rgba(0, 0, 0, 0)'
        assert target_node.evaluate('n => getComputedStyle(n).boxShadow') == 'none'
        target_node.click(button='right')
        menu.locator('[id$="CounterName"]').fill('Charge')
        menu.locator('[data-card-action="counter"][data-delta="1"]').click()
        assert game(f'cards["{target}"].namedCounters.Charge') == 1
        target_node.click(button='right')
        page.keyboard.press('Escape')
        assert menu.count() == 0
        assert page.locator('#goldfishDialog').is_visible()
        target_node.click(button='right')
        page.locator('#goldfishTitle').click()
        assert menu.count() == 0
        # Existing multiselection is retained when right-clicking a member.
        extra = game('zones.hand[0]')
        page.locator(f'#goldfishHand [data-card="{extra}"]').click(modifiers=['Control'])
        target_node.click(button='right')
        assert page.evaluate('practiceSelected.size') == 2
        menu.locator('[id$="Destination"]').select_option('graveyard')
        menu.locator('[data-card-action="move"]').click()
        assert target in game('zones.graveyard') and extra in game('zones.graveyard')
        # Keep menus inside the viewport even near its lower-right corner.
        other = page.locator('#goldfishHand [data-card]').first
        other.evaluate("n => n.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:1278, clientY:718}))")
        rect = menu.bounding_box()
        assert rect['x'] + rect['width'] <= 1280
        assert rect['y'] + rect['height'] <= 720
        page.keyboard.press('Escape')
        assert not errors, errors
        browser.close()
        print('Desktop tabletop interaction checks passed.')


if __name__ == "__main__":
    main()
