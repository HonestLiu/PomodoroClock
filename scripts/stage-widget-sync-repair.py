"""Stage a bundle with matching metadata for local signing; leave installed app intact."""
import argparse
import pathlib
import plistlib
import shutil
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--app", type=pathlib.Path, required=True)
parser.add_argument("--team", required=True)
args = parser.parse_args()
if len(args.team) != 10 or not args.team.isalnum():
    parser.error("Expected the actual 10-character Apple signing team identifier")
root = pathlib.Path(__file__).resolve().parent.parent
stage_root = root / "macos/build"
stage_root.mkdir(parents=True, exist_ok=True)
stage = pathlib.Path(tempfile.mkdtemp(prefix="sync-repair-", dir=stage_root))
app = stage / "FocusPomodoro.app"
shutil.copytree(args.app, app, symlinks=True)
group = f"{args.team}.com.focuspomodoro.shared"
for plist in [app / "Contents/Info.plist", app / "Contents/PlugIns/FocusWidgets.appex/Contents/Info.plist"]:
    with plist.open("rb") as stream:
        info = plistlib.load(stream)
    info["FocusWidgetAppGroup"] = group
    with plist.open("wb") as stream:
        plistlib.dump(info, stream)
for source, name in [("src-tauri/Entitlements.plist", "Host.entitlements"),
                     ("macos/Widgets/Widgets.entitlements", "Widget.entitlements")]:
    with (root / source).open("rb") as stream:
        entitlements = plistlib.load(stream)
    entitlements["com.apple.security.application-groups"] = [group]
    entitlements.pop("com.apple.developer.team-identifier", None)
    with (stage / name).open("wb") as stream:
        plistlib.dump(entitlements, stream)
print(stage)
