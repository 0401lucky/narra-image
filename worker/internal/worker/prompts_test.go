package worker

import (
	"context"
	"encoding/json"
	"testing"
)

func TestParsePromptSourceMarkdown(t *testing.T) {
	source := PromptSource{
		Parser:     "awesome-gpt-image",
		RawBaseURL: "https://raw.githubusercontent.com/example/repo/main",
		Slug:       "awesome-gpt-image",
	}

	items, err := parsePromptSource(context.Background(), source, func(ctx context.Context, source PromptSource, filePath string) (string, error) {
		return `
## 🧃 产品/海报

### [蓝莓苏打海报](https://example.com/case)

![](assets/blueberry.jpg)

**提示词:**

` + "```" + `
复古蓝莓薰衣草苏打海报，手帐拼贴，柔和自然光。
` + "```" + `
`, nil
	})
	if err != nil {
		t.Fatalf("parsePromptSource returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 prompt, got %d", len(items))
	}
	if items[0].Title != "蓝莓苏打海报" {
		t.Fatalf("unexpected title: %s", items[0].Title)
	}
	if items[0].CoverURL != "https://raw.githubusercontent.com/example/repo/main/assets/blueberry.jpg" {
		t.Fatalf("unexpected cover: %s", items[0].CoverURL)
	}
	if len(items[0].Tags) != 2 || items[0].Tags[0] != "产品" || items[0].Tags[1] != "海报" {
		t.Fatalf("unexpected tags: %#v", items[0].Tags)
	}
}

func TestParsePromptSourceJSON(t *testing.T) {
	source := PromptSource{
		Parser:     "davidwu-gpt-image2-prompts",
		RawBaseURL: "https://raw.githubusercontent.com/example/json-prompts/main",
		Slug:       "davidwu-gpt-image2-prompts",
	}
	raw, _ := json.Marshal([]map[string]any{{
		"author":      "OpenLab",
		"category":    "Poster",
		"category_cn": "海报",
		"id":          7,
		"image":       "images/poster.png",
		"needs_ref":   true,
		"note":        "适合商业视觉",
		"prompt":      "高级香氛海报，中心构图，微距产品摄影。",
		"source":      "github",
		"title_cn":    "香氛海报",
		"title_en":    "Fragrance poster",
	}})

	items, err := parsePromptSource(context.Background(), source, func(ctx context.Context, source PromptSource, filePath string) (string, error) {
		return string(raw), nil
	})
	if err != nil {
		t.Fatalf("parsePromptSource returned error: %v", err)
	}
	if items[0].RemoteID != "davidwu-gpt-image2-prompts-007" {
		t.Fatalf("unexpected remote id: %s", items[0].RemoteID)
	}
	if items[0].CoverURL != "https://raw.githubusercontent.com/example/json-prompts/main/images/poster.png" {
		t.Fatalf("unexpected cover: %s", items[0].CoverURL)
	}
	if !containsString(items[0].Tags, "需要参考图") {
		t.Fatalf("expected reference tag, got %#v", items[0].Tags)
	}
}

func TestParsePromptSourceGptImage2(t *testing.T) {
	source := PromptSource{
		Parser:     "gpt-image-2-prompts",
		RawBaseURL: "https://raw.githubusercontent.com/example/gpt-image-2/main",
		Slug:       "gpt-image-2-prompts",
	}

	files := map[string]string{
		"data/ingested_tweets.json": `{
			"records": [{
				"title": "Lavender Soda Poster",
				"tweet_url": "https://x.com/example/status/1",
				"image_dir": "images/lavender-soda",
				"category": "Poster & Product Cases"
			}]
		}`,
		"README.md": `### Case 1: [Lavender Soda Poster](https://x.com/example/status/1)

**Prompt:**

` + "```" + `
Vintage-inspired blueberry lavender soda scrapbook poster.
` + "```",
	}

	items, err := parsePromptSource(context.Background(), source, func(ctx context.Context, source PromptSource, filePath string) (string, error) {
		return files[filePath], nil
	})
	if err != nil {
		t.Fatalf("parsePromptSource returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 prompt, got %d", len(items))
	}
	if items[0].CoverURL != "https://raw.githubusercontent.com/example/gpt-image-2/main/images/lavender-soda/output.jpg" {
		t.Fatalf("unexpected cover: %s", items[0].CoverURL)
	}
	if items[0].Prompt != "Vintage-inspired blueberry lavender soda scrapbook poster." {
		t.Fatalf("unexpected prompt: %s", items[0].Prompt)
	}
	if len(items[0].Tags) != 2 || items[0].Tags[0] != "poster" || items[0].Tags[1] != "product" {
		t.Fatalf("unexpected tags: %#v", items[0].Tags)
	}
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
