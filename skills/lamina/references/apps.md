# Lamina Apps — worked examples

Load when actually doing apps work. The main `SKILL.md` covers app contract reading + decision rule per parameter + the featured catalog by vertical. This reference adds **4 worked examples** teaching the distinct dispatch patterns you'll see across the catalog.

Each example shows: what the user said → how the agent discovered the App → the contract it read → the confirmation message → the dispatch.

## Example 1 — Single upload, multi-output subset (the baseline)

**User:** "Generate lifestyle shots for my new pendant — here's the photo."

```
# Discover
lamina apps list jewelry pendant lifestyle ecommerce --json
# → "Necklace and Earrings" (top hit)

# Read the contract
lamina apps get <appId> --json
# parameters: 1 — "Necklace and earrings" (type=url, accept=['image'])
# outputs: 4 — "Lifestyle Image 1", "Lifestyle Image 2", "Lifestyle Image 3", "Output 4"
```

**Confirmation to the user:** "I'll use **Necklace and Earrings**. Just need your product photo (you've got one), and the workflow produces 4 lifestyle images. Want all 4 or a subset?"

**User:** "All 4 is fine."

```
lamina assets upload ./pendant.jpg --json
# → { data: { url: "https://media.../..." } }

lamina run <appId> \
  --input necklace_and_earrings_image_url="https://media.../..." \
  --wait --timeout-ms 60000 --json
```

## Example 2 — Multi-upload + many curated choices (catalog with on-model)

**User:** "Catalog shots for my saree — Front and Back only, no video. Model should be Indian."

```
# Discover (Product Catalog or Saree Catalog as vertical fit)
lamina apps list "product catalog" saree on-model ecommerce --json

# Read the contract (Product Catalog)
# parameters: 8 — 1 text (Product) + 7 options-type fields
#   (ethnicity, gender, body_type, hair_color, hair_style, hair_length, environment)
# outputs: 4 — "Front View", "Back View", "Side View", "Catalog Video"
```

**Confirmation:** "I'll use **Product Catalog**. You mentioned the saree, Indian model, and Front/Back only. The app also takes gender, body type, hair color / style / length, and environment — defaults are available, or you can pick. Here's what's available for each:
- Gender: Female / Male
- Body type: Slim / Average / Plus
- Hair color: Black / Brown / Blonde / Red / Grey / White
- Hair style: Straight / Wavy / Curly / Coily
- Hair length: Short / Medium / Long
- Environment: Studio / Outdoor / Lifestyle / Cafe / Beach

Want to pick any of these, or run with defaults?"

**User:** "Defaults are fine. Just front and back."

```
lamina run <appId> \
  --input product_import_product="Saree — emerald green silk with gold border" \
  --input ethnicity_text="Indian" \
  --output "Front View" --output "Back View" \
  --wait --timeout-ms 180000 --json
```

## Example 3 — Heavy multi-output subsetting (multi-language banner)

**User:** "Banner for my swimsuit, need it in EN/ES/DE/FR — vertical + square only, skip horizontal."

```
# Discover
lamina apps list banner swimsuit multi-language localization adapt --json
# → "Multi Language Adapts"

# Read the contract
# parameters: 5 — image_input (url), logo (url), 3 English text inputs
# outputs: 15 — 5 languages × 3 aspect ratios
```

**Confirmation:** "I'll use **Multi Language Adapts**. Need from you:
- Banner image (please upload)
- Logo (please upload)
- Headline, subtext, CTA (in English — the workflow translates)

15 outputs across 5 languages × 3 aspect ratios. You said EN/ES/DE/FR + vertical (9:16) and square (1:1). I'll run those 8 and skip horizontal + Arabic."

```
lamina assets upload ./banner.jpg --json
lamina assets upload ./logo.png --json

lamina run <appId> \
  --input image_input_image_url="https://media.../banner.jpg" \
  --input logo_image_url="https://media.../logo.png" \
  --input headline_english_text="Summer Drop" \
  --input subtext_english_text="Limited Edition" \
  --input cta_english_text="Shop Now" \
  --output "English 1:1" --output "English 9:16" \
  --output "Spanish 1:1" --output "Spanish 9:16" \
  --output "German 1:1" --output "German 9:16" \
  --output "French 1:1" --output "French 9:16" \
  --wait --timeout-ms 300000 --json
```

8 outputs instead of 15. The subset is explicit because the brief specified it.

## Example 4 — No-upload async video (the polling pattern)

**User:** "Make me a 15-second product reel — fresh juice brand, energetic morning vibe."

```
# Discover
lamina apps list "quick reel" product video Instagram 9:16 --json
# → "Quick Reel Maker"

# Read the contract
# parameters: 2 — "Describe your idea" (text), "Visual style" (options, 7 choices)
# outputs: 6 — 5 intermediary shots + "Your fresh hot reel"
```

**Confirmation:** "I'll use **Quick Reel Maker**. Just two inputs — your idea (you've described it: 'fresh juice, energetic morning'), and a visual style. The 7 styles: Cinematic / Minimalist / Vibrant / Vintage / Nature / Studio / Lifestyle. Default is Cinematic. Which fits your brand?

This is video, takes 2–4 minutes, so I'll dispatch async and poll for progress."

**User:** "Use Vibrant."

```
lamina run <appId> \
  --input describe_your_idea_text="fresh juice brand, energetic morning vibe" \
  --input visual_style_text="Vibrant" \
  --async --json
# → returns runId immediately

# Poll in bounded chunks; surface progress between polls
lamina runs wait <runId> --timeout-ms 120000 --json
# → still running? poll again
# → completed? returns the 6 outputs (5 intermediary + the final reel)
```

For video, never use raw `--wait` without a tight `--timeout-ms` — it can wedge the chat for 10+ minutes.
