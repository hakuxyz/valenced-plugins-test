# Valenced Plugins Test

Temporary test repository for Valenced plugins under development.

```
https://hakuxyz.github.io/valenced-plugins-test/index.json
```

Open the plugin settings, tap a color to use Discord's picker or enter a hex
value, then press **Copy 3y3** and paste the invisible text into your bio.

This repository is removed after testing. The stable repository is
`https://hakuxyz.github.io/valenced-plugins/index.json`.

## Image Fixer

**Version:** 1.0.5

Keep low-resolution image uploads sharp by rendering them like pasted image links
and loading the original attachment URL.

- **Image link rendering.** A single matching image attachment is rendered through Discord's image link path, which keeps its natural size.
- **Original URLs.** Resize parameters are removed and Discord media proxy links are replaced with the original CDN URL.
- **Local settings.** Choose small images or all image attachments, set the small image limit, and turn each fix off independently.

Changes apply to newly rendered messages. Reload the channel if an old image keeps its previous appearance.
