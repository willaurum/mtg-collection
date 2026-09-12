# PyInstaller spec - builds a single-file MTGCardViewer.exe.
#   pyinstaller MTGCardViewer.spec
# The templates and static folders must ride along; server.py reads them from
# sys._MEIPASS at runtime.

block_cipher = None

a = Analysis(
    ["desktop_app.py"],
    pathex=[],
    binaries=[],
    datas=[
        ("templates", "templates"),
        ("static", "static"),
    ],
    hiddenimports=[
        "webview.platforms.winforms",
        "clr_loader",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "PIL"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="MTGCardViewer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # no console window behind the app
    icon="static/icon.ico" if __import__("os").path.exists("static/icon.ico") else None,
)
