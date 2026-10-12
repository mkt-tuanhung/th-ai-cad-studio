# dmgbuild settings: the MD CAD AI STUDIO installer window (macOS "installer welcome").
# Background art: packaging/macos/art/dmg-background.tiff (1× + 2×, exported from the app by
# ui/tools/make-installer-art.mjs) — brand, tagline, an arrow from the app to Applications and the credit
# line "Xây dựng và phát triển bởi Minh Dũng". Used by make_dmg.sh: dmgbuild -s dmg_settings.py -D app=…
import os

app = defines.get('app')  # noqa: F821 (dmgbuild provides `defines`)
# dmgbuild runs this file without __file__: make_dmg.sh passes the native/ folder as -D root=…
here = os.path.join(defines.get('root', os.getcwd()), 'packaging', 'macos')  # noqa: F821
name = os.path.basename(app)

format = 'ULMO'  # LZMA, macOS 10.15+ (the app needs 14+)
filesystem = 'HFS+'
files = [app]
symlinks = {'Applications': '/Applications'}
icon = os.path.join(here, '..', '..', 'app', 'resources', 'branding', 'AppIcon.icns')  # the volume icon
badge_icon = None
background = os.path.join(here, 'art', 'dmg-background.tiff')
window_rect = ((200, 140), (660, 420))
default_view = 'icon-view'
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 112
text_size = 12
icon_locations = {name: (165, 242), 'Applications': (495, 242)}
hide_extension = [name]
