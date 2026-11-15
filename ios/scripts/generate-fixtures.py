from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
resources = root / "TAKE" / "Resources"
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
font = lambda size: ImageFont.truetype(font_path, size)
palettes = {
    "alex": ("#c4d4b2", "#a66746", "#392a26", "#d9ed68", 330),
    "blair": ("#bcb0dc", "#dfac84", "#302b37", "#6e618a", 392),
    "casey": ("#ecc0ab", "#ac7963", "#211f29", "#c1b8e8", 440),
    "dana": ("#becbda", "#e7b99a", "#5b3d32", "#c7de83", 494),
}
for index, (name, (bg, skin, hair, shirt, frequency)) in enumerate(palettes.items()):
    image = Image.new("RGB", (600, 900), bg)
    d = ImageDraw.Draw(image)
    d.rounded_rectangle((36, 40, 224, 82), radius=21, fill="#141815")
    d.text((55, 51), "FICTIONAL SAMPLE", font=font(16), fill="#eeeede")
    d.ellipse((-70, 585, 680, 1250), fill=shirt)
    d.rounded_rectangle((235, 455, 365, 670), radius=45, fill=skin)
    d.ellipse((139, 170, 470, 571), fill=hair)
    d.ellipse((158, 223, 451, 596), fill=skin)
    d.ellipse((126, 352, 190, 442), fill=skin)
    d.ellipse((418, 352, 475, 442), fill=skin)
    d.pieslice((139, 170, 470, 420), 175, 358, fill=hair)
    if index % 2:
        d.rounded_rectangle((150, 260, 206, 506), radius=28, fill=hair)
        d.rounded_rectangle((420, 260, 468, 506), radius=23, fill=hair)
    d.arc((218, 349, 265, 375), 190, 350, fill=hair, width=5)
    d.arc((340, 349, 387, 375), 190, 350, fill=hair, width=5)
    d.ellipse((237, 388, 248, 400), fill="#262725")
    d.ellipse((357, 388, 368, 400), fill="#262725")
    d.line((304, 402, 291, 456, 312, 458), fill="#865d4f", width=5)
    d.arc((259, 463, 352, 520), 5, 175, fill="#733d39", width=7)
    d.text((38, 714), name.upper(), font=font(55), fill="#151b15")
    d.text((40, 783), "A LITTLE PERSPECTIVE.", font=font(19), fill="#151b15")
    d.rounded_rectangle((36, 838, 564, 875), radius=18, fill="#151b15")
    d.text((64, 848), "LOCAL CLIP / SYNTHETIC SOUND / 4 SEC", font=font(14), fill="#f3f2e7")
    poster = resources / f"poster-{name}.png"
    image.save(poster, optimize=True)
    image.crop((100, 200, 500, 600)).resize((240, 240)).save(resources / f"avatar-{name}.png", optimize=True)
    if name in ("alex", "blair"):
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", str(poster), "-f", "lavfi", "-i", f"sine=frequency={frequency}:sample_rate=44100:duration=4", "-vf", "scale=360:540,zoompan=z='min(zoom+0.00015,1.02)':d=1:s=360x540:fps=24,format=yuv420p", "-af", "volume=0.12,afade=t=in:d=0.2,afade=t=out:st=3.5:d=0.5", "-t", "4", "-c:v", "libx264", "-profile:v", "main", "-crf", "24", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(resources / f"sample-{name}.mp4")], check=True)

icon = Image.new("RGB", (1024, 1024), "#c9f557")
d = ImageDraw.Draw(icon)
d.rounded_rectangle((92, 92, 932, 932), radius=210, fill="#141815")
d.text((144, 375), "TAKE", font=font(239), fill="#f5f2e7", stroke_width=1)
d.ellipse((759, 690, 835, 766), fill="#c9f557")
icon_dir = root / "TAKE/Resources/Assets.xcassets/AppIcon.appiconset"
icon_dir.mkdir(parents=True, exist_ok=True)
icon.save(icon_dir / "AppIcon.png", optimize=True)
