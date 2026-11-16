package worker

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestManagedImagePublicTokenUsesOriginAndLiteralCanonicalPath(t *testing.T) {
	token := strings.Repeat("a", 64)
	path := "/prefix/media/images/" + token
	for _, test := range []struct {
		name, base, source string
		valid              bool
	}{
		{"canonical", "https://app.example.test/prefix", "https://app.example.test" + path, true},
		{"normalized-base-authority", "https://APP.example.test:443/prefix/", "https://app.example.test" + path, true},
		{"normalized-input-authority", "https://app.example.test/prefix", "https://APP.example.test:443" + path, true},
		{"normalized-numeric-port", "https://app.example.test/prefix", "https://app.example.test:0443" + path, true},
		{"http-default-port", "http://app.example.test/prefix", "http://APP.example.test:80" + path, true},
		{"explicit-port", "https://app.example.test:8443/prefix", "https://APP.example.test:8443" + path, true},
		{"ipv6-authority", "https://[2001:db8::1]/prefix", "https://[2001:0db8:0:0:0:0:0:1]:443" + path, true},
		{"different-origin", "https://app.example.test/prefix", "https://other.example.test" + path, false},
		{"host-prefix", "https://app.example.test/prefix", "https://app.example.test.other.test" + path, false},
		{"trailing-dot-origin", "https://app.example.test/prefix", "https://app.example.test." + path, false},
		{"different-scheme", "https://app.example.test/prefix", "http://app.example.test" + path, false},
		{"different-port", "https://app.example.test/prefix", "https://app.example.test:8443" + path, false},
		{"invalid-port", "https://app.example.test/prefix", "https://app.example.test:65536" + path, false},
		{"mapped-ipv4-is-different-origin", "https://192.0.2.1/prefix", "https://[::ffff:192.0.2.1]" + path, false},
		{"missing-prefix", "https://app.example.test/prefix", "https://app.example.test/media/images/" + token, false},
		{"dot-segment", "https://app.example.test/prefix", "https://app.example.test/prefix/../prefix/media/images/" + token, false},
		{"encoded-dot-segment", "https://app.example.test/prefix", "https://app.example.test/prefix/%2e%2e/prefix/media/images/" + token, false},
		{"encoded-token", "https://app.example.test/prefix", "https://app.example.test/prefix/media/images/%61" + token[1:], false},
		{"credentials", "https://app.example.test/prefix", "https://user@app.example.test" + path, false},
		{"backslash", "https://app.example.test/prefix", "https://app.example.test\\" + path, false},
		{"query", "https://app.example.test/prefix", "https://app.example.test" + path + "?signed=1", false},
		{"empty-query", "https://app.example.test/prefix", "https://app.example.test" + path + "?", false},
		{"fragment", "https://app.example.test/prefix", "https://app.example.test" + path + "#view", false},
		{"empty-fragment", "https://app.example.test/prefix", "https://app.example.test" + path + "#", false},
		{"trailing-slash", "https://app.example.test/prefix", "https://app.example.test" + path + "/", false},
		{"trailing-newline", "https://app.example.test/prefix", "https://app.example.test" + path + "\n", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := managedImagePublicToken(test.source, test.base)
			if (got == token) != test.valid || (!test.valid && got != "") {
				t.Fatalf("token identity = %q, expected valid=%v", got, test.valid)
			}
		})
	}
}

type gatewayInputAliasRecord struct{ assetID, url string }

type gatewayInputAliasRepository struct {
	images      map[string]*ManagedImage
	lookups     []string
	aliases     []gatewayInputAliasRecord
	lookupErr   error
	registerErr error
}

func (repository *gatewayInputAliasRepository) GetByToken(_ context.Context, token string) (*ManagedImage, error) {
	repository.lookups = append(repository.lookups, token)
	return repository.images[token], repository.lookupErr
}

func (repository *gatewayInputAliasRepository) RegisterAlias(_ context.Context, assetID, rawURL string) error {
	repository.aliases = append(repository.aliases, gatewayInputAliasRecord{assetID, rawURL})
	return repository.registerErr
}

func TestGatewayManagedInputsBindExactAliasesInStableOrderWithoutChangingInputs(t *testing.T) {
	tokenA, tokenB := strings.Repeat("a", 64), strings.Repeat("b", 64)
	assetA, assetB := "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
	base := "https://APP.example.test:443/prefix"
	urlA := "https://app.example.test/prefix/media/images/" + tokenA
	variantA := "https://APP.example.test:443/prefix/media/images/" + tokenA
	urlB := "https://app.example.test/prefix/media/images/" + tokenB
	sources := []string{urlB, urlA, "https://unrelated.example.test/media/images/" + tokenA, variantA, urlB}
	original := append([]string(nil), sources...)
	version := "legacy-version"
	repository := &gatewayInputAliasRepository{images: map[string]*ManagedImage{
		tokenA: {Asset: ImageAssetRecord{ID: assetA, PublicToken: tokenA, State: "AVAILABLE", OwnerID: "other-owner"}, Object: &ImageObjectRecord{State: "READY", Provenance: "WRITE", PutOutcome: "CONFIRMED", VersionID: &version}, Location: &ImageLocation{}},
		tokenB: {Asset: ImageAssetRecord{ID: assetB, PublicToken: tokenB, State: "AVAILABLE", OwnerID: "input-owner"}, Object: &ImageObjectRecord{State: "READY"}, Location: &ImageLocation{}},
	}}
	if err := registerGatewayManagedInputAliases(context.Background(), repository, base, sources); err != nil {
		t.Fatal(err)
	}
	want := []gatewayInputAliasRecord{{assetA, variantA}, {assetA, urlA}, {assetB, urlB}}
	if !reflect.DeepEqual(repository.aliases, want) || !reflect.DeepEqual(sources, original) || len(repository.lookups) != 3 {
		t.Fatalf("input aliases/order/provenance changed: aliases=%+v inputs=%v lookups=%v", repository.aliases, sources, repository.lookups)
	}
}

func TestGatewayManagedInputsFailClosedBeforeBusinessInsertion(t *testing.T) {
	token := strings.Repeat("a", 64)
	base := "https://app.example.test"
	canonical := base + "/media/images/" + token
	for _, state := range []string{"missing", "PENDING", "QUARANTINED", "DELETING", "DELETED", "missing-object", "wrong-token", "database-error", "alias-conflict"} {
		t.Run(state, func(t *testing.T) {
			image := &ManagedImage{Asset: ImageAssetRecord{ID: historyTestAssetID, PublicToken: token, State: "AVAILABLE"}, Object: &ImageObjectRecord{State: "READY"}, Location: &ImageLocation{}}
			repository := &gatewayInputAliasRepository{images: map[string]*ManagedImage{token: image}}
			want := "IMAGE_UNAVAILABLE"
			switch state {
			case "missing":
				delete(repository.images, token)
			case "missing-object":
				image.Object = nil
			case "wrong-token":
				image.Asset.PublicToken = strings.Repeat("b", 64)
			case "database-error":
				repository.lookupErr = ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
				want = "IMAGE_STORAGE_UNAVAILABLE"
			case "alias-conflict":
				repository.registerErr = ImageStorageError{Code: "IMAGE_REFERENCE_CONFLICT"}
				want = "IMAGE_REFERENCE_CONFLICT"
			default:
				image.Asset.State = state
			}
			err := registerGatewayManagedInputAliases(context.Background(), repository, base, []string{canonical})
			var failure ImageStorageError
			if !errors.As(err, &failure) || failure.Code != want || (state != "alias-conflict" && len(repository.aliases) != 0) {
				t.Fatalf("unavailable input was accepted: %v aliases=%+v", err, repository.aliases)
			}
		})
	}
	for _, sources := range [][]string{nil, {}, {"https://external.example.test/media/images/" + token}, {canonical + "?signed=1"}} {
		if err := registerGatewayManagedInputAliases(context.Background(), nil, base, sources); err != nil {
			t.Fatalf("unrecognized source required an owned token dependency: %v", err)
		}
	}
}

func TestGatewayOwnTokenReadRecognitionMatchesAliasBindingWithWritesDisabled(t *testing.T) {
	_, image, _ := historyManagedLocalReadFixture(t)
	encoded, err := json.Marshal(image)
	if err != nil {
		t.Fatal(err)
	}
	for _, managedWrites := range []bool{false, true} {
		queryer := &historyTokenQueryer{image: encoded}
		base := "https://APP.example.test:443/prefix"
		storage := &Storage{cfg: Config{AppURL: base, ImageStorageManagedEnabled: managedWrites}, imageRepository: NewImageRepository(queryer)}
		canonical := "https://app.example.test/prefix/media/images/" + image.Asset.PublicToken
		resolved, err := storage.resolveManagedImage(context.Background(), canonical)
		if err != nil || resolved == nil || resolved.Asset.ID != image.Asset.ID || len(queryer.queries) != 1 || !strings.Contains(queryer.queries[0], "image_get_by_token") {
			t.Fatalf("reader/binder token identity disagreed or read mutated aliases: writes=%v error=%v queries=%v", managedWrites, err, queryer.queries)
		}
	}
}
