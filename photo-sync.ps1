# ===== GHIELENS PHOTO SYNC TEST =====

Write-Host "🐒 Ghielens photo sync test starting..."
Write-Host ""

# Change this later once we know the exact location
$photoSource = "C:\PATH\TO\Data-data\100 jaar\aaa"

Write-Host "Looking for photos in:"
Write-Host $photoSource
Write-Host ""

if (!(Test-Path $photoSource)) {
    Write-Host "❌ Folder not found."
    Write-Host "We need the exact Windows path to the aaa folder."
    pause
    exit
}

$extensions = @("*.jpg", "*.jpeg", "*.png", "*.webp")

$photos = foreach ($extension in $extensions) {
    Get-ChildItem -Path $photoSource -Filter $extension -File
}

Write-Host "📸 Photos found: $($photos.Count)"
Write-Host ""

foreach ($photo in $photos) {
    Write-Host "✅ $($photo.Name)"
}

Write-Host ""
Write-Host "🎉 Test complete."
pause
