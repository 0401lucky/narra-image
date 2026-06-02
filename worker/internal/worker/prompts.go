package worker

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const promptSyncTimeout = 30 * time.Second

type PromptSource struct {
	Description string
	ID          string
	Name        string
	Parser      string
	RawBaseURL  string
	Slug        string
	SortOrder   int
	SourceURL   string
}

type PromptItem struct {
	CoverURL    string
	Preview     string
	PreviewURLs []string
	Prompt      string
	RemoteID    string
	SortOrder   int
	Tags        []string
	Title       string
}

type PromptSyncResult struct {
	Count  int
	Slug   string
	Status string
}

type PromptSyncer struct {
	logger *slog.Logger
	pool   *pgxpool.Pool
}

type promptFetcher func(ctx context.Context, source PromptSource, filePath string) (string, error)

var defaultPromptSources = []PromptSource{
	{
		Description: "EvoLinkAI 整理的 GPT Image 2 API 案例，覆盖广告、角色、海报、电商与 UI 等图像方向。",
		Name:        "GPT Image 2 Prompts",
		Parser:      "gpt-image-2-prompts",
		RawBaseURL:  "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main",
		Slug:        "gpt-image-2-prompts",
		SortOrder:   10,
		SourceURL:   "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
	},
	{
		Description: "ZeroLu 的中文 GPT Image 案例集合，按视觉类型整理示例图和提示词。",
		Name:        "Awesome GPT Image",
		Parser:      "awesome-gpt-image",
		RawBaseURL:  "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main",
		Slug:        "awesome-gpt-image",
		SortOrder:   20,
		SourceURL:   "https://github.com/ZeroLu/awesome-gpt-image",
	},
	{
		Description: "ImgEdify 收集的 GPT-4o 图像提示词案例，包含中英文说明与结果图。",
		Name:        "Awesome GPT-4o Image Prompts",
		Parser:      "awesome-gpt4o-image-prompts",
		RawBaseURL:  "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main",
		Slug:        "awesome-gpt4o-image-prompts",
		SortOrder:   30,
		SourceURL:   "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts",
	},
	{
		Description: "YouMind OpenLab 的 GPT Image 2 中文提示词精选，适合快速寻找成片方向。",
		Name:        "YouMind GPT Image 2",
		Parser:      "youmind-gpt-image-2",
		RawBaseURL:  "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main",
		Slug:        "youmind-gpt-image-2",
		SortOrder:   40,
		SourceURL:   "https://github.com/YouMind-OpenLab/awesome-gpt-image-2",
	},
	{
		Description: "YouMind OpenLab 的 Nano Banana Pro 提示词集合，偏产品、海报与写实创作场景。",
		Name:        "YouMind Nano Banana Pro",
		Parser:      "youmind-nano-banana-pro",
		RawBaseURL:  "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main",
		Slug:        "youmind-nano-banana-pro",
		SortOrder:   50,
		SourceURL:   "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
	},
	{
		Description: "davidwuw0811-boop 的 GPT Image 2 提示词 JSON 数据源，包含分类、作者和参考图标记。",
		Name:        "awesome-gpt-image2-prompts",
		Parser:      "davidwu-gpt-image2-prompts",
		RawBaseURL:  "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main",
		Slug:        "davidwu-gpt-image2-prompts",
		SortOrder:   60,
		SourceURL:   "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts",
	},
}

var gptImage2CaseFiles = []string{
	"README.md",
	"cases/ad-creative.md",
	"cases/character.md",
	"cases/comparison.md",
	"cases/ecommerce.md",
	"cases/portrait.md",
	"cases/poster.md",
	"cases/ui.md",
}

func DefaultPromptSources() []PromptSource {
	items := make([]PromptSource, len(defaultPromptSources))
	copy(items, defaultPromptSources)
	for i := range items {
		items[i].ID = promptSourceID(items[i].Slug)
	}
	return items
}

func NewPromptSyncer(pool *pgxpool.Pool, logger *slog.Logger) *PromptSyncer {
	return &PromptSyncer{pool: pool, logger: logger}
}

func (s *PromptSyncer) SyncAll(ctx context.Context) ([]PromptSyncResult, error) {
	if err := s.ensureDefaultPromptSources(ctx); err != nil {
		return nil, err
	}

	sources, err := s.enabledPromptSources(ctx)
	if err != nil {
		return nil, err
	}

	results := make([]PromptSyncResult, 0, len(sources))
	for _, source := range sources {
		result, err := s.SyncSource(ctx, source.Slug)
		if err != nil {
			return results, err
		}
		results = append(results, result)
	}
	return results, nil
}

func (s *PromptSyncer) SyncSource(ctx context.Context, idOrSlug string) (PromptSyncResult, error) {
	if err := s.ensureDefaultPromptSources(ctx); err != nil {
		return PromptSyncResult{}, err
	}

	source, err := s.findPromptSource(ctx, idOrSlug)
	if err != nil {
		return PromptSyncResult{}, err
	}

	if _, err := s.pool.Exec(ctx, `UPDATE "PromptSource" SET status = 'SYNCING', "lastSyncError" = NULL, "updatedAt" = NOW() WHERE id = $1`, source.ID); err != nil {
		return PromptSyncResult{}, err
	}

	items, err := parsePromptSource(ctx, source, fetchPromptFile)
	if err != nil {
		_ = s.markPromptSourceFailed(ctx, source.ID, err)
		return PromptSyncResult{}, err
	}
	items = normalizePromptItems(items)
	if len(items) == 0 {
		err := errors.New("没有从该来源解析到提示词")
		_ = s.markPromptSourceFailed(ctx, source.ID, err)
		return PromptSyncResult{}, err
	}

	if err := s.replacePromptItems(ctx, source.ID, items); err != nil {
		_ = s.markPromptSourceFailed(ctx, source.ID, err)
		return PromptSyncResult{}, err
	}

	if s.logger != nil {
		s.logger.Info("提示词来源同步完成", "source", source.Slug, "count", len(items))
	}
	return PromptSyncResult{Count: len(items), Slug: source.Slug, Status: "SUCCESS"}, nil
}

func (s *PromptSyncer) ensureDefaultPromptSources(ctx context.Context) error {
	for _, source := range DefaultPromptSources() {
		_, err := s.pool.Exec(ctx, `
INSERT INTO "PromptSource" (
  id, slug, name, description, "sourceUrl", "rawBaseUrl", parser,
  "isEnabled", "sortOrder", status, "itemCount", "createdAt", "updatedAt"
) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, 'IDLE', 0, NOW(), NOW())
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  "sourceUrl" = EXCLUDED."sourceUrl",
  "rawBaseUrl" = EXCLUDED."rawBaseUrl",
  parser = EXCLUDED.parser,
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = NOW()
`, source.ID, source.Slug, source.Name, source.Description, source.SourceURL, source.RawBaseURL, source.Parser, source.SortOrder)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *PromptSyncer) enabledPromptSources(ctx context.Context) ([]PromptSource, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, slug, name, description, "sourceUrl", "rawBaseUrl", parser, "sortOrder"
FROM "PromptSource"
WHERE "isEnabled" = true
ORDER BY "sortOrder" ASC, "createdAt" ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPromptSources(rows)
}

func (s *PromptSyncer) findPromptSource(ctx context.Context, idOrSlug string) (PromptSource, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, slug, name, description, "sourceUrl", "rawBaseUrl", parser, "sortOrder"
FROM "PromptSource"
WHERE id = $1 OR slug = $1
LIMIT 1
`, idOrSlug)
	if err != nil {
		return PromptSource{}, err
	}
	defer rows.Close()
	items, err := scanPromptSources(rows)
	if err != nil {
		return PromptSource{}, err
	}
	if len(items) == 0 {
		return PromptSource{}, errors.New("提示词来源不存在")
	}
	return items[0], nil
}

func scanPromptSources(rows pgx.Rows) ([]PromptSource, error) {
	var items []PromptSource
	for rows.Next() {
		var item PromptSource
		if err := rows.Scan(&item.ID, &item.Slug, &item.Name, &item.Description, &item.SourceURL, &item.RawBaseURL, &item.Parser, &item.SortOrder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *PromptSyncer) replacePromptItems(ctx context.Context, sourceID string, items []PromptItem) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	remoteIDs := make([]string, 0, len(items))
	for _, item := range items {
		remoteIDs = append(remoteIDs, item.RemoteID)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "PromptLibraryItem" WHERE "sourceId" = $1 AND NOT ("remoteId" = ANY($2))`, sourceID, remoteIDs); err != nil {
		return err
	}

	for _, item := range items {
		if _, err := tx.Exec(ctx, `
INSERT INTO "PromptLibraryItem" (
  id, "sourceId", "remoteId", title, prompt, "coverUrl", preview,
  "previewUrls", tags, "sortOrder", "createdAt", "updatedAt", "syncedAt"
) VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), $8, $9, $10, NOW(), NOW(), NOW())
ON CONFLICT ("sourceId", "remoteId") DO UPDATE SET
  title = EXCLUDED.title,
  prompt = EXCLUDED.prompt,
  "coverUrl" = EXCLUDED."coverUrl",
  preview = EXCLUDED.preview,
  "previewUrls" = EXCLUDED."previewUrls",
  tags = EXCLUDED.tags,
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = NOW(),
  "syncedAt" = NOW()
`, promptItemID(sourceID, item.RemoteID), sourceID, item.RemoteID, item.Title, item.Prompt, item.CoverURL, item.Preview, item.PreviewURLs, item.Tags, item.SortOrder); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `UPDATE "PromptSource" SET status = 'SUCCESS', "lastSyncError" = NULL, "lastSyncedAt" = NOW(), "itemCount" = $2, "updatedAt" = NOW() WHERE id = $1`, sourceID, len(items)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *PromptSyncer) markPromptSourceFailed(ctx context.Context, sourceID string, syncErr error) error {
	_, err := s.pool.Exec(ctx, `UPDATE "PromptSource" SET status = 'FAILED', "lastSyncError" = $2, "updatedAt" = NOW() WHERE id = $1`, sourceID, syncErr.Error())
	return err
}

func parsePromptSource(ctx context.Context, source PromptSource, fetch promptFetcher) ([]PromptItem, error) {
	switch source.Parser {
	case "gpt-image-2-prompts":
		return parseGptImage2Prompts(ctx, source, fetch)
	case "awesome-gpt-image":
		return parseAwesomeGptImage(ctx, source, fetch)
	case "awesome-gpt4o-image-prompts":
		return parseAwesomeGpt4oImage(ctx, source, fetch)
	case "youmind-gpt-image-2":
		return parseYouMindPrompts(ctx, source, fetch, "gpt-image-2")
	case "youmind-nano-banana-pro":
		return parseYouMindPrompts(ctx, source, fetch, "nano-banana-pro")
	case "davidwu-gpt-image2-prompts":
		return parseDavidWuPrompts(ctx, source, fetch)
	default:
		return nil, fmt.Errorf("未知提示词解析器：%s", source.Parser)
	}
}

func fetchPromptFile(ctx context.Context, source PromptSource, filePath string) (string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, promptSyncTimeout)
	defer cancel()

	url := strings.TrimRight(source.RawBaseURL, "/") + "/" + strings.TrimLeft(filePath, "/")
	request, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "text/plain,application/json,text/markdown,*/*")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("%s 拉取失败：HTTP %d", filePath, response.StatusCode)
	}
	data, err := io.ReadAll(response.Body)
	return string(data), err
}

type gptImage2Data struct {
	Records []struct {
		Category string `json:"category"`
		ImageDir string `json:"image_dir"`
		Title    string `json:"title"`
		TweetURL string `json:"tweet_url"`
	} `json:"records"`
}

func parseGptImage2Prompts(ctx context.Context, source PromptSource, fetch promptFetcher) ([]PromptItem, error) {
	raw, err := fetch(ctx, source, "data/ingested_tweets.json")
	if err != nil {
		return nil, err
	}
	var data gptImage2Data
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return nil, err
	}

	cases := map[string]string{}
	for _, filePath := range gptImage2CaseFiles {
		markdown, err := fetch(ctx, source, filePath)
		if err != nil {
			return nil, err
		}
		collectGptImage2Cases(cases, markdown)
	}

	var items []PromptItem
	for index, record := range data.Records {
		prompt := strings.TrimSpace(cases[strings.TrimSpace(record.TweetURL)])
		title := strings.TrimSpace(record.Title)
		if prompt == "" || title == "" || record.ImageDir == "" {
			continue
		}
		cover := absolutePromptURL(source.RawBaseURL, record.ImageDir+"/output.jpg")
		items = append(items, PromptItem{
			CoverURL:    cover,
			Preview:     markdownPreview([]string{cover}),
			PreviewURLs: []string{cover},
			Prompt:      prompt,
			RemoteID:    "tweet-" + stableSlug(record.TweetURL),
			SortOrder:   index + 1,
			Tags:        tagsFromCategory(record.Category),
			Title:       title,
		})
	}
	return items, nil
}

func collectGptImage2Cases(cases map[string]string, markdown string) {
	re := regexp.MustCompile(`(?s)### Case \d+: \[[^\]]+]\(([^)]+)\).*?\*\*Prompt:\*\*\s*\r?\n\s*` + "```" + `[\w-]*\r?\n(.*?)\r?\n` + "```")
	for _, match := range re.FindAllStringSubmatch(markdown, -1) {
		cases[strings.TrimSpace(match[1])] = strings.TrimSpace(match[2])
	}
}

func parseAwesomeGptImage(ctx context.Context, source PromptSource, fetch promptFetcher) ([]PromptItem, error) {
	markdown, err := fetch(ctx, source, "README.zh-CN.md")
	if err != nil {
		return nil, err
	}

	var items []PromptItem
	for _, section := range splitBeforeHeading(markdown, "## ") {
		sectionTags := tagsFromHeading(firstMatch(section, `(?m)^##\s+(.+)$`))
		for _, block := range splitBeforeHeading(section, "### ") {
			title := strings.TrimSpace(markdownLinkText(firstMatch(block, `(?m)^###\s+(.+)$`)))
			prompt := strings.TrimSpace(firstMatch(block, `(?s)\*\*提示词:\*\*\s*\r?\n\s*`+"```"+`[\w-]*\r?\n(.*?)\r?\n`+"```"))
			if title == "" || prompt == "" {
				continue
			}
			images := extractMarkdownImages(source.RawBaseURL, block)
			items = append(items, PromptItem{
				CoverURL:    firstString(images),
				Preview:     markdownPreview(images),
				PreviewURLs: images,
				Prompt:      prompt,
				RemoteID:    source.Slug + "-" + leftPad(len(items)+1),
				SortOrder:   len(items) + 1,
				Tags:        sectionTags,
				Title:       title,
			})
		}
	}
	return items, nil
}

func parseAwesomeGpt4oImage(ctx context.Context, source PromptSource, fetch promptFetcher) ([]PromptItem, error) {
	markdown, err := fetch(ctx, source, "README.zh-CN.md")
	if err != nil {
		return nil, err
	}

	var items []PromptItem
	for _, block := range splitBeforeHeading(markdown, "### ") {
		title := strings.TrimSpace(firstMatch(block, `(?m)^###\s+(.+)$`))
		prompt := strings.TrimSpace(firstMatch(block, `(?s)-\s+\*\*提示词文本：\*\*\s*`+"`"+`(.*?)`+"`"))
		if title == "" || prompt == "" {
			continue
		}
		images := extractMarkdownImages(source.RawBaseURL, block)
		items = append(items, PromptItem{
			CoverURL:    firstString(images),
			Preview:     markdownPreview(images),
			PreviewURLs: images,
			Prompt:      prompt,
			RemoteID:    source.Slug + "-" + leftPad(len(items)+1),
			SortOrder:   len(items) + 1,
			Tags:        []string{"gpt4o"},
			Title:       title,
		})
	}
	return items, nil
}

func parseYouMindPrompts(ctx context.Context, source PromptSource, fetch promptFetcher, modelTag string) ([]PromptItem, error) {
	markdown, err := fetch(ctx, source, "README_zh.md")
	if err != nil {
		return nil, err
	}

	var items []PromptItem
	for _, block := range splitBeforeHeading(markdown, "### ") {
		title := strings.TrimSpace(firstMatch(block, `(?m)^###\s+No\.\s*\d+:\s*(.+)$`))
		prompt := strings.TrimSpace(firstMatch(block, `(?s)#### .*?提示词\s*\r?\n\s*`+"```"+`[\w-]*\r?\n(.*?)\r?\n`+"```"))
		if title == "" || prompt == "" {
			continue
		}
		images := extractMarkdownImages(source.RawBaseURL, block)
		items = append(items, PromptItem{
			CoverURL:    firstString(images),
			Preview:     markdownPreview(images),
			PreviewURLs: images,
			Prompt:      prompt,
			RemoteID:    source.Slug + "-" + leftPad(len(items)+1),
			SortOrder:   len(items) + 1,
			Tags:        youMindTags(title, modelTag),
			Title:       title,
		})
	}
	return items, nil
}

type davidWuPrompt struct {
	Author     string `json:"author"`
	Category   string `json:"category"`
	CategoryCN string `json:"category_cn"`
	ID         int    `json:"id"`
	Image      string `json:"image"`
	NeedsRef   bool   `json:"needs_ref"`
	Note       string `json:"note"`
	Prompt     string `json:"prompt"`
	Source     string `json:"source"`
	TitleCN    string `json:"title_cn"`
	TitleEN    string `json:"title_en"`
}

func parseDavidWuPrompts(ctx context.Context, source PromptSource, fetch promptFetcher) ([]PromptItem, error) {
	raw, err := fetch(ctx, source, "prompts.json")
	if err != nil {
		return nil, err
	}
	var data []davidWuPrompt
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return nil, err
	}

	var items []PromptItem
	for index, record := range data {
		title := strings.TrimSpace(record.TitleCN)
		if title == "" {
			title = strings.TrimSpace(record.TitleEN)
		}
		prompt := strings.TrimSpace(record.Prompt)
		if title == "" || prompt == "" {
			continue
		}
		cover := absolutePromptURL(source.RawBaseURL, record.Image)
		items = append(items, PromptItem{
			CoverURL:    cover,
			Preview:     strings.Join(nonEmpty(record.TitleEN, record.Note, markdownPreview([]string{cover})), "\n\n"),
			PreviewURLs: nonEmpty(cover),
			Prompt:      prompt,
			RemoteID:    source.Slug + "-" + leftPad(recordID(record.ID, index)),
			SortOrder:   index + 1,
			Tags:        davidWuTags(record),
			Title:       title,
		})
	}
	return items, nil
}

func normalizePromptItems(items []PromptItem) []PromptItem {
	seen := map[string]bool{}
	var result []PromptItem
	for _, item := range items {
		item.Title = truncate(strings.TrimSpace(item.Title), 180)
		item.Prompt = strings.TrimSpace(item.Prompt)
		item.RemoteID = strings.TrimSpace(item.RemoteID)
		item.CoverURL = strings.TrimSpace(item.CoverURL)
		item.Preview = strings.TrimSpace(item.Preview)
		item.PreviewURLs = limitStrings(nonEmpty(item.PreviewURLs...), 8)
		item.Tags = limitStrings(uniqueSorted(item.Tags), 80)
		if item.Title == "" || item.Prompt == "" || item.RemoteID == "" || seen[item.RemoteID] {
			continue
		}
		seen[item.RemoteID] = true
		result = append(result, item)
	}
	return result
}

func splitBeforeHeading(markdown string, prefix string) []string {
	var blocks []string
	var current []string
	for _, line := range strings.Split(markdown, "\n") {
		if strings.HasPrefix(line, prefix) && len(current) > 0 {
			blocks = append(blocks, strings.Join(current, "\n"))
			current = nil
		}
		current = append(current, line)
	}
	if len(current) > 0 {
		blocks = append(blocks, strings.Join(current, "\n"))
	}
	return blocks
}

func firstMatch(value string, pattern string) string {
	match := regexp.MustCompile(pattern).FindStringSubmatch(value)
	if len(match) > 1 {
		return match[1]
	}
	return ""
}

func markdownLinkText(value string) string {
	return regexp.MustCompile(`\[([^\]]+)]\([^)]+\)`).ReplaceAllString(value, "$1")
}

func extractMarkdownImages(baseURL string, block string) []string {
	seen := map[string]bool{}
	var images []string
	for _, pattern := range []string{`<img[^>]+src=["']([^"']+)["']`, `!\[[^\]]*]\(([^)]+)\)`} {
		re := regexp.MustCompile(pattern)
		for _, match := range re.FindAllStringSubmatch(block, -1) {
			image := absolutePromptURL(baseURL, stripMarkdownURL(match[1]))
			if image != "" && !seen[image] {
				seen[image] = true
				images = append(images, image)
			}
		}
	}
	return images
}

func stripMarkdownURL(value string) string {
	trimmed := strings.Trim(strings.TrimSpace(value), "<>")
	return strings.Fields(trimmed + " ")[0]
}

func absolutePromptURL(baseURL string, rawPath string) string {
	image := strings.TrimSpace(rawPath)
	if image == "" || strings.HasPrefix(image, "data:") {
		return ""
	}
	lower := strings.ToLower(image)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return image
	}
	image = strings.TrimLeft(strings.TrimPrefix(image, "."), "/")
	return strings.TrimRight(baseURL, "/") + "/" + image
}

func markdownPreview(images []string) string {
	var lines []string
	for _, image := range images {
		if strings.TrimSpace(image) != "" {
			lines = append(lines, "![]("+image+")")
		}
	}
	return strings.Join(lines, "\n\n")
}

func tagsFromCategory(category string) []string {
	value := regexp.MustCompile(`(?i)\s+Cases$`).ReplaceAllString(category, "")
	return splitTags(value, regexp.MustCompile(`(?i)\s*(?:&|and)\s*`))
}

func tagsFromHeading(heading string) []string {
	clean := regexp.MustCompile(`[^\w\x{4e00}-\x{9fa5}/&、与 ]`).ReplaceAllString(heading, "")
	return splitTags(clean, regexp.MustCompile(`\s*(?:/|&|、|与)\s*`))
}

func youMindTags(title string, modelTag string) []string {
	prefix := strings.SplitN(title, " - ", 2)[0]
	return uniqueSorted(append([]string{modelTag}, tagsFromHeading(prefix)...))
}

func davidWuTags(item davidWuPrompt) []string {
	tags := splitTags(strings.Join(nonEmpty(item.CategoryCN, item.Category, item.Author, item.Source), "/"), regexp.MustCompile(`/`))
	if item.NeedsRef {
		tags = append(tags, "需要参考图")
	}
	return uniqueSorted(tags)
}

func splitTags(value string, pattern *regexp.Regexp) []string {
	var tags []string
	for _, tag := range pattern.Split(value, -1) {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag != "" {
			tags = append(tags, tag)
		}
	}
	return uniqueSorted(tags)
}

func uniqueSorted(values []string) []string {
	seen := map[string]bool{}
	var result []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}

func nonEmpty(values ...string) []string {
	var result []string
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, strings.TrimSpace(value))
		}
	}
	return result
}

func limitStrings(values []string, limit int) []string {
	if len(values) <= limit {
		return values
	}
	return values[:limit]
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func leftPad(value int) string {
	if value >= 1000 {
		return strconv.Itoa(value)
	}
	return fmt.Sprintf("%03d", value)
}

func recordID(id int, index int) int {
	if id > 0 {
		return id
	}
	return index + 1
}

func stableSlug(value string) string {
	slug := regexp.MustCompile(`[^a-zA-Z0-9]+`).ReplaceAllString(strings.ToLower(value), "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return "item"
	}
	return slug
}

func promptSourceID(slug string) string {
	return "prompt_source_" + shortHash(slug)
}

func promptItemID(sourceID string, remoteID string) string {
	return "prompt_" + shortHash(sourceID+"|"+remoteID)
}

func shortHash(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])[:24]
}

func truncate(value string, max int) string {
	if len([]rune(value)) <= max {
		return value
	}
	return string([]rune(value)[:max])
}
