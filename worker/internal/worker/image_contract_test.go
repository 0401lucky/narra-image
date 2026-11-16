package worker

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImageContractRootSupportedLayouts(t *testing.T) {
	for _, layout := range []string{"project", "native-package", "binary-root", "binary-bin", "app-container"} {
		t.Run(layout, func(t *testing.T) {
			base := t.TempDir()
			app := filepath.Join(base, "app")
			root := filepath.Join(app, "contracts", "media", "v1")
			if err := os.MkdirAll(root, 0700); err != nil {
				t.Fatal(err)
			}
			cwd := filepath.Join(base, "unrelated")
			executable := filepath.Join(base, "elsewhere", "worker.exe")
			switch layout {
			case "project", "app-container":
				cwd = app
			case "native-package":
				cwd = filepath.Join(app, "worker", "internal", "worker")
			case "binary-root":
				executable = filepath.Join(app, "worker.exe")
			case "binary-bin":
				executable = filepath.Join(app, "bin", "worker.exe")
			}
			if err := os.MkdirAll(cwd, 0700); err != nil {
				t.Fatal(err)
			}
			actual, err := imageContractRoot(cwd, executable)
			if err != nil || actual != root {
				t.Fatalf("resolved %q, %v; want %q", actual, err, root)
			}
		})
	}
}

func TestImageContractRootPrefersNearbyPackagedArtifacts(t *testing.T) {
	base := t.TempDir()
	checkout := filepath.Join(base, "contracts", "media", "v1")
	packaged := filepath.Join(base, "isolated", "app", "contracts", "media", "v1")
	for _, root := range []string{checkout, packaged} {
		if err := os.MkdirAll(root, 0700); err != nil {
			t.Fatal(err)
		}
	}
	cwd := filepath.Join(base, "fixtures", "run", "working")
	if err := os.MkdirAll(cwd, 0700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(base, "isolated", "app", "bin", "worker.exe")
	actual, err := imageContractRoot(cwd, executable)
	if err != nil || actual != packaged {
		t.Fatalf("packaged artifact replaced by an ancestor checkout: %q, %v", actual, err)
	}
}

func TestImageContractRootDoesNotSearchDistantAncestors(t *testing.T) {
	base := t.TempDir()
	checkout := filepath.Join(base, "contracts", "media", "v1")
	if err := os.MkdirAll(checkout, 0700); err != nil {
		t.Fatal(err)
	}
	cwd := filepath.Join(base, "a", "b", "c", "d")
	if err := os.MkdirAll(cwd, 0700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(base, "e", "f", "g", "h", "worker.exe")
	if actual, err := imageContractRoot(cwd, executable); err == nil || actual != "" {
		t.Fatalf("missing installation silently selected distant artifacts: %q, %v", actual, err)
	}
}

func TestImageContractAndBudget(t *testing.T) {
	if err := LoadImageContract(); err != nil {
		t.Fatal(err)
	}
	if ImageDefaultQuotaBytes != 5_000_000_000 || ImageDefaultQuotaBytes <= 2_147_483_647 {
		t.Fatal("image quota lost bigint precision")
	}
	budget, err := ImageOutputBudget(4)
	if err != nil || budget != 209_715_200 {
		t.Fatalf("budget = %d, %v", budget, err)
	}
	for _, count := range []int{-1, 0, 5, 1000000} {
		if _, err := ImageOutputBudget(count); err == nil {
			t.Fatalf("accepted output count %d", count)
		}
	}
}

func TestImageS3UsesSharedLocationVectors(t *testing.T) {
	contract := loadTestCanvasContract(t)
	var fixture struct {
		Vectors []struct {
			ID    string `json:"id"`
			Input struct {
				Endpoint string `json:"endpoint"`
				Region   string `json:"region"`
				Bucket   string `json:"bucket"`
			} `json:"input"`
			Valid           bool   `json:"valid"`
			StorageLocation string `json:"storageLocation"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(contract.Scenarios["storage-location"], &fixture); err != nil {
		t.Fatal(err)
	}
	for _, vector := range fixture.Vectors {
		t.Run(vector.ID, func(t *testing.T) {
			location, err := NewImageS3Location(vector.Input.Endpoint, vector.Input.Region, vector.Input.Bucket, "")
			if !vector.Valid {
				if err == nil {
					t.Fatal("accepted invalid origin")
				}
				return
			}
			if err != nil || location.ID != vector.StorageLocation || location.VolumeID != "" {
				t.Fatalf("location = %+v, %v", location, err)
			}
		})
	}
}

func TestImageLocalIdentityAndURLs(t *testing.T) {
	volume := "00112233-4455-4677-8899-aabbccddeeff"
	location, err := NewImageLocalLocation(volume)
	if err != nil || location.ID != "local-v1:"+volume || location.Endpoint != "" || location.Bucket != "" {
		t.Fatalf("location = %+v, %v", location, err)
	}
	for _, invalid := range []string{"/data/images", `E:\images`, strings.ToUpper(volume), ""} {
		if _, err := NewImageLocalLocation(invalid); err == nil {
			t.Fatalf("accepted volume %q", invalid)
		}
	}
	token := strings.Repeat("a", 64)
	url, err := ImagePublicURL("https://images.example.test/", token)
	if err != nil || url != "https://images.example.test/media/images/"+token {
		t.Fatalf("url = %s, %v", url, err)
	}
	for _, base := range []string{"file:///data", "https://user@images.example.test", " https://:secret@images.example.test", "https://images.example.test?secret=1"} {
		if _, err := ImagePublicURL(base, token); err == nil {
			t.Fatalf("accepted credential/query base %q", base)
		}
		if _, err := NewImageS3Location("https://s3.example.test", "auto", "images", base); err == nil {
			t.Fatalf("accepted S3 public base %q", base)
		}
	}
}

func TestImageSharedInputBoundaries(t *testing.T) {
	data, err := readImageContractArtifact("scenarios/input-boundaries.json", 64*1024)
	if err != nil {
		t.Fatal(err)
	}
	var boundaries struct {
		Version            int      `json:"version"`
		InvalidVolumeIDs   []string `json:"invalidVolumeIds"`
		InvalidDigests     []string `json:"invalidDigests"`
		InvalidByteLengths []string `json:"invalidByteLengths"`
	}
	if err := json.Unmarshal(data, &boundaries); err != nil || boundaries.Version != 1 {
		t.Fatalf("invalid shared input boundaries: %v", err)
	}
	for _, value := range boundaries.InvalidVolumeIDs {
		if _, err := NewImageLocalLocation(value); err == nil {
			t.Fatalf("accepted noncanonical volume %q", value)
		}
		if imageUUIDPattern.MatchString(value) {
			t.Fatalf("accepted noncanonical image UUID %q", value)
		}
	}
	for _, value := range boundaries.InvalidDigests {
		if _, err := ImagePublicURL("https://images.example.test", value); err == nil {
			t.Fatalf("accepted noncanonical token %q", value)
		}
		if imagePublicTokenPattern.MatchString(value) {
			t.Fatalf("accepted noncanonical digest %q", value)
		}
	}
	reservation := ImageReservation{ID: "00112233-4455-4677-8899-aabbccddeeff", OwnerID: "owner", Kind: "INPUT", State: "ACTIVE", SlotBytes: []string{"10"}}
	reservation.Token = reservation.ID
	if !validImageReservation(reservation) {
		t.Fatal("valid decimal control failed")
	}
	for _, value := range boundaries.InvalidByteLengths {
		reservation.SlotBytes = []string{value}
		if validImageReservation(reservation) {
			t.Fatalf("accepted noncanonical bytes %q", value)
		}
	}
}

func TestImageBytesUseDecimalJSONString(t *testing.T) {
	value := ImageUsage{Policy: ImagePolicy{Scope: "images", LimitBytes: ImageDefaultQuotaBytes}, UsedBytes: 2_306_867_200, ReservedBytes: 209_715_200}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"usedBytes":"2306867200"`) || !strings.Contains(string(encoded), `"limitBytes":"5000000000"`) {
		t.Fatalf("not decimal-string encoded: %s", encoded)
	}
	var decoded ImageUsage
	if err := json.Unmarshal(encoded, &decoded); err != nil || decoded.UsedBytes != value.UsedBytes {
		t.Fatalf("roundtrip: %+v, %v", decoded, err)
	}
	if err := json.Unmarshal([]byte(`{"usedBytes":2306867200}`), &decoded); err == nil {
		t.Fatal("silently accepted JSON number where decimal string is required")
	}
}
