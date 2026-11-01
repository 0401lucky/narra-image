package worker

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCanvasStorageLocationSharedScenarios(t *testing.T) {
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
			Material        string `json:"material"`
			StorageLocation string `json:"storageLocation"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(contract.Scenarios["storage-location"], &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Vectors) != 28 {
		t.Fatalf("got %d storage-location vectors, want all 28", len(fixture.Vectors))
	}
	for _, vector := range fixture.Vectors {
		t.Run(vector.ID, func(t *testing.T) {
			location, err := NewCanvasStorageLocation(vector.Input.Endpoint, vector.Input.Region, vector.Input.Bucket)
			if !vector.Valid {
				if err == nil || location != (CanvasStorageLocation{}) {
					t.Fatalf("invalid location was accepted: %+v", location)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if location.ID != vector.StorageLocation {
				t.Fatalf("ID %q, want %q", location.ID, vector.StorageLocation)
			}
			material, err := json.Marshal([3]string{location.Endpoint, location.Region, location.Bucket})
			if err != nil {
				t.Fatal(err)
			}
			if string(material) != vector.Material {
				t.Fatalf("material %s, want %s", material, vector.Material)
			}
			replayed, err := NewCanvasStorageLocation(location.Endpoint, location.Region, location.Bucket)
			if err != nil || replayed != location {
				t.Fatalf("canonical tuple is not stable: %+v, %v", replayed, err)
			}
		})
	}
}

func TestCanvasStorageLocationPreservesTupleIdentity(t *testing.T) {
	base, err := NewCanvasStorageLocation("https://s3.example.test", "Region-1", "Bucket_1")
	if err != nil {
		t.Fatal(err)
	}
	equivalent, err := NewCanvasStorageLocation("\uFEFF HTTPS://S3.EXAMPLE.TEST:443/\u00A0", " Region-1\t", "Bucket_1\n")
	if err != nil || equivalent != base {
		t.Fatalf("canonical trim/case/default-port tuple changed: %+v, %v", equivalent, err)
	}
	for _, input := range [][3]string{
		{"http://s3.example.test", "Region-1", "Bucket_1"},
		{"https://s3.example.test:444", "Region-1", "Bucket_1"},
		{"https://other.example.test", "Region-1", "Bucket_1"},
		{"https://s3.example.test", "region-1", "Bucket_1"},
		{"https://s3.example.test", "Region-1", "bucket_1"},
	} {
		location, err := NewCanvasStorageLocation(input[0], input[1], input[2])
		if err != nil {
			t.Fatal(err)
		}
		if location.ID == base.ID {
			t.Fatalf("different storage tuple aliases %s", location.ID)
		}
	}
}

func TestCanvasStorageLocationRejectsAmbiguousOriginsAndBounds(t *testing.T) {
	for _, endpoint := range []string{
		"", "https://", "https:///s3.test", "https://s3.test:65536", "https://s3.test:00080", "https://s3.test:-1", "https://s3.test:+80", "https://s3.test:",
		"https://s3.test#", "https://s3.test/?", "https://s3.test/.", "https://s3.test/%2f", "https://s3.test\\anything", "https://user@s3.test", "https://s3.test\t.invalid",
		"http://2130706433", "http://127.00.0.1", "http://127.0.0.256", "http://127.0.0.1.", "http://0x7f.0.0.1", "http://127.0x0.0.1", "http://host.123",
		"http://[0000::1]", "http://[1:0:0:2:0:0:3:4]", "http://[1:0:0:2::3:4]", "http://[::ffff:127.0.0.1]", "http://[127.0.0.1]", "http://[::1%zone]",
		"https://%65xample.test", "https://s3_test", "https://s3.\u4f8b\u5b50", "https://" + strings.Repeat("a", 505), "\u0085https://s3.test",
	} {
		t.Run(endpoint, func(t *testing.T) {
			if _, err := NewCanvasStorageLocation(endpoint, "auto", "bucket"); err == nil {
				t.Fatal("ambiguous/noncanonical origin was accepted")
			}
		})
	}
	for _, components := range [][2]string{
		{"auto", strings.Repeat("b", 256)}, {strings.Repeat("r", 129), "bucket"}, {".region", "bucket"}, {"auto", "-bucket"}, {"a b", "bucket"}, {"auto", "bucket%2fkey"},
	} {
		if _, err := NewCanvasStorageLocation("https://s3.test", components[0], components[1]); err == nil {
			t.Fatalf("invalid components accepted: %q %q", components[0], components[1])
		}
	}
	if _, err := NewCanvasStorageLocation("https://s3.test", strings.Repeat("r", 128), strings.Repeat("b", 255)); err != nil {
		t.Fatalf("exact component bounds rejected: %v", err)
	}
}

func TestCanvasStorageLocationCanonicalIPv6(t *testing.T) {
	for input, expected := range map[string]string{
		"http://[::]":                    "http://[::]",
		"http://[1::]":                   "http://[1::]",
		"http://[1:2:3:4:5:6:7:8]":       "http://[1:2:3:4:5:6:7:8]",
		"http://[1::2:0:0:3:4]":          "http://[1::2:0:0:3:4]",
		"https://[::FFFF:7F00:1]:443/":   "https://[::ffff:7f00:1]",
		"http://[2001:DB8:1:2:3:4:5:A]/": "http://[2001:db8:1:2:3:4:5:a]",
	} {
		location, err := NewCanvasStorageLocation(input, "auto", "bucket")
		if err != nil || location.Endpoint != expected {
			t.Errorf("%q -> %q, %v; want %q", input, location.Endpoint, err, expected)
		}
	}
}

func TestCanvasStorageLocationDoesNotExposeInvalidInputs(t *testing.T) {
	_, err := NewCanvasStorageLocation("https://private-user:private-secret@s3.example.test?token=private-token", "auto", "bucket")
	if err == nil || strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "s3.example") {
		t.Fatalf("error exposes input secrets: %v", err)
	}
}
