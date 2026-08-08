package worker

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
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

const markdownFixture = `## 🧃 产品

### [蓝莓苏打海报](https://example.com/case)

![](assets/blueberry.jpg)

**提示词:**

` + "```" + `
复古蓝莓薰衣草苏打海报。
` + "```" + `
`

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func TestPromptSourcesRootUsesEnvOverride(t *testing.T) {
	tmp := t.TempDir()
	manifest := `{"contract":"narra.prompts.default-sources","version":1,"sources":[` +
		`{"slug":"probe-a","name":"Probe A","parser":"awesome-gpt-image",` +
		`"rawBaseUrl":"https://example.com/a","sourceUrl":"https://example.com/a","sortOrder":10}]}`
	if err := os.WriteFile(filepath.Join(tmp, defaultPromptSourcesManifest), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PROMPT_SOURCES_DIR", tmp)

	root, err := promptSourcesRoot()
	if err != nil {
		t.Fatalf("promptSourcesRoot returned error: %v", err)
	}
	if filepath.Clean(root) != filepath.Clean(tmp) {
		t.Fatalf("expected override root %s, got %s", tmp, root)
	}

	sources, err := loadDefaultPromptSources()
	if err != nil {
		t.Fatalf("loadDefaultPromptSources returned error: %v", err)
	}
	if len(sources) != 1 || sources[0].Slug != "probe-a" {
		t.Fatalf("expected manifest from override dir, got %+v", sources)
	}
}

func TestPromptSourcesRootFallsBackWhenOverrideMissing(t *testing.T) {
	t.Setenv("PROMPT_SOURCES_DIR", filepath.Join(t.TempDir(), "does-not-exist"))

	root, err := promptSourcesRoot()
	if err != nil {
		t.Fatalf("promptSourcesRoot should fall back to source-relative path: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, defaultPromptSourcesManifest)); err != nil {
		t.Fatalf("manifest not reachable at %s: %v", root, err)
	}
}

func TestFindPromptSourcesRootReportsDiagnosticError(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope")
	_, err := findPromptSourcesRoot([]string{"", missing})
	if err == nil {
		t.Fatal("expected error when no candidate contains the manifest")
	}
	if !strings.Contains(err.Error(), defaultPromptSourcesManifest) {
		t.Fatalf("expected diagnostic error naming manifest, got: %v", err)
	}
}

func TestRunPromptSyncSchedulerRunsOnInterval(t *testing.T) {
	worker := New(nil, Config{PromptSyncInterval: 5 * time.Millisecond}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	var calls int32
	worker.runPromptSyncScheduler(ctx, func(ctx context.Context) ([]PromptSyncResult, error) {
		atomic.AddInt32(&calls, 1)
		return []PromptSyncResult{{Slug: "test", Status: "SUCCESS"}}, nil
	})
	if atomic.LoadInt32(&calls) < 2 {
		t.Fatalf("expected scheduler to run at least twice, got %d", calls)
	}
}

func TestRunPromptSyncSchedulerContinuesAfterFailure(t *testing.T) {
	worker := New(nil, Config{PromptSyncInterval: 5 * time.Millisecond}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	var calls int32
	worker.runPromptSyncScheduler(ctx, func(ctx context.Context) ([]PromptSyncResult, error) {
		atomic.AddInt32(&calls, 1)
		return []PromptSyncResult{{Slug: "test", Status: "FAILED"}}, errors.New("source fetch failed")
	})
	if atomic.LoadInt32(&calls) < 2 {
		t.Fatalf("expected scheduler to keep running after failure, got %d", calls)
	}
}
