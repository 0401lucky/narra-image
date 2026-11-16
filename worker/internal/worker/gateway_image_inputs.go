package worker

import (
	"context"
	"sort"
)

type gatewayManagedInputRepository interface {
	GetByToken(context.Context, string) (*ManagedImage, error)
	RegisterAlias(context.Context, string, string) error
}

// registerGatewayManagedInputAliases runs inside the job transaction, after
// its reference epoch and before any business row. A token reader may accept
// the current publication base or equivalent authority spellings without an
// existing exact alias. Store the accepted spelling so the job INSERT trigger
// can attach its permanent root while keeping sourceImageUrls unchanged.
func registerGatewayManagedInputAliases(ctx context.Context, repository gatewayManagedInputRepository, appURL string, sourceURLs []string) error {
	type inputAlias struct{ assetID, url string }
	aliases := make([]inputAlias, 0, len(sourceURLs))
	seen := make(map[string]bool, len(sourceURLs))
	for _, rawURL := range sourceURLs {
		token := managedImagePublicToken(rawURL, appURL)
		if token == "" || seen[rawURL] {
			continue
		}
		seen[rawURL] = true
		image, err := repository.GetByToken(ctx, token)
		if err != nil {
			return err
		}
		// Ordinary public inputs may have another owner and may still use a
		// legacy versioned READY replica. Reader validity, not migration or
		// deletion eligibility, decides whether this source can be accepted.
		if image == nil || image.Asset.PublicToken != token || image.Asset.State != "AVAILABLE" || image.Object == nil || image.Object.State != "READY" || image.Location == nil {
			return ImageStorageError{Code: "IMAGE_UNAVAILABLE"}
		}
		aliases = append(aliases, inputAlias{assetID: image.Asset.ID, url: rawURL})
	}
	sort.Slice(aliases, func(a, b int) bool {
		if aliases[a].assetID != aliases[b].assetID {
			return aliases[a].assetID < aliases[b].assetID
		}
		return aliases[a].url < aliases[b].url
	})
	for _, alias := range aliases {
		if err := repository.RegisterAlias(ctx, alias.assetID, alias.url); err != nil {
			return err
		}
	}
	return nil
}
