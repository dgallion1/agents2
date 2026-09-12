package zzoracle_cm1

// CM1 oracle — lead-authored, executed by accept.sh, deleted afterwards.
// Asserts the observable behaviour of every consumer of a saved plan's
// start date and ages: Load, LoadContextWithRevision, LoadScenarioSettings,
// Save, the persisted file, and healthcare-person ages.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"budget2/internal/models"
	"budget2/internal/services/retirement"
	"budget2/internal/services/storage"
)

func nowMonth() string { return time.Now().Format("2006-01") }

func ageNow(t *testing.T, birth string) int {
	t.Helper()
	a, err := models.DeriveAgeAtStartDate(nowMonth(), birth)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func readRaw(t *testing.T, path string) map[string]any {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func newRoot(t *testing.T, files map[string]map[string]any) (string, *retirement.SettingsManager) {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "settings")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, raw := range files {
		b, _ := json.MarshalIndent(raw, "", "  ")
		if err := os.WriteFile(filepath.Join(dir, name), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	st, err := storage.New(root)
	if err != nil {
		t.Fatal(err)
	}
	return dir, retirement.NewSettingsManager(dir, st)
}

// liveShaped returns a copy of the real plan file with the start date pinned
// to an old month and the new field removed, so a featureless tree fails.
func liveShaped(t *testing.T, env string) map[string]any {
	t.Helper()
	p := os.Getenv(env)
	if p == "" {
		t.Fatalf("%s not set", env)
	}
	raw := readRaw(t, p)
	raw["start_date"] = "2025-01"
	delete(raw, "use_current_month")
	// Keep the saved healthcare ages consistent with the pinned start date
	// (they are positional in the live file), as a real save would have.
	persons, _ := raw["persons"].([]any)
	hcs, _ := raw["healthcare_persons"].([]any)
	for i := range hcs {
		if i < len(persons) {
			birth, _ := persons[i].(map[string]any)["birth_month"].(string)
			a, err := models.DeriveAgeAtStartDate("2025-01", birth)
			if err != nil {
				t.Fatal(err)
			}
			hcs[i].(map[string]any)["current_age"] = a
		}
	}
	return raw
}

func TestOracleA_LivePlanFollowsCurrentMonth(t *testing.T) {
	raw := liveShaped(t, "ORACLE_LIVE")
	dir, sm := newRoot(t, map[string]map[string]any{"whatif.json": raw})
	s, err := sm.Load()
	if err != nil {
		t.Fatal(err)
	}
	if s.StartDate != nowMonth() {
		t.Fatalf("A1 start_date = %q, want current month %q", s.StartDate, nowMonth())
	}
	var wantAges []int
	for _, p := range s.Persons {
		want := ageNow(t, p.BirthMonth)
		wantAges = append(wantAges, want)
		if got := s.PersonAge(p.ID); got != want {
			t.Errorf("A2 person %s age = %d, want %d", p.Name, got, want)
		}
	}
	if pr := s.GetPrimaryPerson(); pr == nil || s.CurrentAge != ageNow(t, pr.BirthMonth) {
		t.Errorf("A3 CurrentAge = %d stale", s.CurrentAge)
	}
	if sp := s.GetSpousePerson(); sp != nil && s.SpouseAge != ageNow(t, sp.BirthMonth) {
		t.Errorf("A3 SpouseAge = %d stale", s.SpouseAge)
	}
	// Healthcare-person ages drive the ACA→Medicare switch; they must follow
	// the persons' ages too (the live file links none of them by person_id).
	var hcAges []int
	for _, h := range s.HealthcarePersons {
		hcAges = append(hcAges, h.CurrentAge)
	}
	sort.Ints(hcAges)
	sort.Ints(wantAges)
	if len(hcAges) != len(wantAges) {
		t.Fatalf("A4 %d healthcare persons vs %d persons", len(hcAges), len(wantAges))
	}
	for i := range hcAges {
		if hcAges[i] != wantAges[i] {
			t.Errorf("A4 healthcare ages %v do not follow person ages %v at %s", hcAges, wantAges, nowMonth())
			break
		}
	}
	for _, h := range s.HealthcarePersons {
		if h.PersonID == "" {
			t.Errorf("A11 healthcare person %q still unlinked after load", h.Name)
			continue
		}
		if p := s.FindPerson(h.PersonID); p == nil || h.BirthMonth != p.BirthMonth {
			t.Errorf("A11 healthcare person %q birth_month %q does not mirror linked person", h.Name, h.BirthMonth)
		}
	}
	origHC := raw["healthcare_persons"].([]any)
	for i, h := range s.HealthcarePersons {
		if want := origHC[i].(map[string]any)["name"]; h.Name != want {
			t.Errorf("A12 healthcare person %d renamed %q -> %q", i, want, h.Name)
		}
	}
	// Birth months untouched, and the migration persisted.
	disk := readRaw(t, filepath.Join(dir, "whatif.json"))
	if disk["use_current_month"] != true {
		t.Errorf("A5 persisted use_current_month = %v, want true", disk["use_current_month"])
	}
	if disk["start_date"] != nowMonth() {
		t.Errorf("A6 persisted start_date = %v, want %s", disk["start_date"], nowMonth())
	}
	origPersons := raw["persons"].([]any)
	diskPersons := disk["persons"].([]any)
	for i := range origPersons {
		if origPersons[i].(map[string]any)["birth_month"] != diskPersons[i].(map[string]any)["birth_month"] {
			t.Errorf("A7 birth_month changed for person %d", i)
		}
	}
	// Cache path and revision path agree.
	again, err := sm.Load()
	if err != nil || again.StartDate != nowMonth() {
		t.Errorf("A8 cached Load start_date = %q err=%v", again.StartDate, err)
	}
	rev, _, err := sm.LoadContextWithRevision(t.Context())
	if err != nil || rev.StartDate != nowMonth() {
		t.Errorf("A9 LoadContextWithRevision start_date = %q err=%v", rev.StartDate, err)
	}
	// Save with a stale date resolves it before writing.
	again.StartDate = "2025-01"
	if err := sm.Save(again); err != nil {
		t.Fatal(err)
	}
	disk = readRaw(t, filepath.Join(dir, "whatif.json"))
	if disk["start_date"] != nowMonth() {
		t.Errorf("A10 Save wrote start_date %v, want %s", disk["start_date"], nowMonth())
	}
}

func TestOracleB_ScenarioFileFollowsCurrentMonth(t *testing.T) {
	scen := liveShaped(t, "ORACLE_SCEN")
	live := liveShaped(t, "ORACLE_LIVE")
	_, sm := newRoot(t, map[string]map[string]any{"whatif.json": live, "whatif_job-loss.json": scen})
	s, err := sm.LoadScenarioSettings("whatif_job-loss.json")
	if err != nil {
		t.Fatal(err)
	}
	if s.StartDate != nowMonth() {
		t.Fatalf("B1 scenario start_date = %q, want %q", s.StartDate, nowMonth())
	}
	if pr := s.GetPrimaryPerson(); pr != nil && s.CurrentAge != ageNow(t, pr.BirthMonth) {
		t.Errorf("B2 scenario CurrentAge = %d stale", s.CurrentAge)
	}
}

func TestOracleC_ExplicitFixedDateStays(t *testing.T) {
	raw := map[string]any{
		"use_current_month": false, "start_date": "2020-01",
		"persons": []any{map[string]any{"id": "you", "name": "You", "role": "primary", "birth_month": "1960-09"}},
	}
	dir, sm := newRoot(t, map[string]map[string]any{"whatif.json": raw})
	s, err := sm.Load()
	if err != nil {
		t.Fatal(err)
	}
	if s.StartDate != "2020-01" || s.CurrentAge != 59 {
		t.Fatalf("C1 fixed plan changed: start=%s age=%d", s.StartDate, s.CurrentAge)
	}
	if err := sm.Save(s); err != nil {
		t.Fatal(err)
	}
	disk := readRaw(t, filepath.Join(dir, "whatif.json"))
	if disk["start_date"] != "2020-01" || disk["use_current_month"] != false {
		t.Fatalf("C2 fixed plan drifted on save: %v %v", disk["start_date"], disk["use_current_month"])
	}
}

func TestOracleD_LegacyAgesMigrateAgainstOriginalDate(t *testing.T) {
	raw := map[string]any{"start_date": "2020-01", "current_age": 60, "spouse_age": 58}
	_, sm := newRoot(t, map[string]map[string]any{"whatif.json": raw})
	s, err := sm.Load()
	if err != nil {
		t.Fatal(err)
	}
	pr, sp := s.GetPrimaryPerson(), s.GetSpousePerson()
	if pr == nil || sp == nil || pr.BirthMonth != "1960-01" || sp.BirthMonth != "1962-01" {
		t.Fatalf("D1 legacy birth months derived wrongly: %+v %+v", pr, sp)
	}
	if s.StartDate != nowMonth() || s.CurrentAge != ageNow(t, "1960-01") || s.SpouseAge != ageNow(t, "1962-01") {
		t.Fatalf("D2 legacy plan not advanced: start=%s ages=%d/%d", s.StartDate, s.CurrentAge, s.SpouseAge)
	}
}

// No false links: ambiguous counts or age-inconsistent entries stay unlinked
// with their ages untouched.
func TestOracleE_NoFalseHealthcareLinks(t *testing.T) {
	persons := []any{
		map[string]any{"id": "p1", "name": "You", "role": "primary", "birth_month": "1958-11"},
		map[string]any{"id": "p2", "name": "Spouse", "role": "spouse", "birth_month": "1971-08"},
	}
	hc := func(name string, age int) map[string]any {
		return map[string]any{"id": "hc-" + name, "name": name, "current_age": age, "current_coverage": "aca",
			"current_monthly_cost": 500, "pre_medicare_inflation": 7, "medicare_monthly_cost": 400,
			"post_medicare_inflation": 4.5, "medicare_eligible_age": 65}
	}
	cases := map[string][]any{
		"three-unlinked-for-two-persons": {hc("Alpha", 67), hc("Beta", 54), hc("Gamma", 30)},
		"age-inconsistent":               {hc("Alpha", 40), hc("Beta", 54)},
		"off-by-one-year":                {hc("Alpha", 66), hc("Beta", 54)}, // exact equality required: 1958-11 is 67 at 2026-04
		"real-names-differ":              {hc("Bob", 67), hc("Sue", 54)},   // persons carry real names below; incompatible names never link
	}
	for name, entries := range cases {
		t.Run(name, func(t *testing.T) {
			ps := persons
			if name == "real-names-differ" {
				ps = []any{
					map[string]any{"id": "p1", "name": "Robert", "role": "primary", "birth_month": "1958-11"},
					map[string]any{"id": "p2", "name": "Susan", "role": "spouse", "birth_month": "1971-08"},
				}
			}
			raw := map[string]any{"start_date": "2026-04", "persons": ps, "healthcare_persons": entries}
			_, sm := newRoot(t, map[string]map[string]any{"whatif.json": raw})
			s, err := sm.Load()
			if err != nil {
				t.Fatal(err)
			}
			for i, h := range s.HealthcarePersons {
				wantAge := int(entries[i].(map[string]any)["current_age"].(int))
				if (name == "age-inconsistent" || name == "off-by-one-year") && i == 1 {
					continue // Beta (54 at 2026-04) is consistent with Spouse; linking it is allowed either way.
				}
				wantName := entries[i].(map[string]any)["name"].(string)
				if h.PersonID != "" || h.CurrentAge != wantAge || h.Name != wantName {
					t.Errorf("E %s: %q linked=%q age=%d, want unlinked %q with age %d", name, h.Name, h.PersonID, h.CurrentAge, wantName, wantAge)
				}
			}
		})
	}
}

// A plan that needs no real migration must not be rewritten on load: the
// absent flag and the resolved start date alone are not a migration.
func TestOracleF_NoWriteOnLoadWithoutMigration(t *testing.T) {
	raw := map[string]any{
		"start_date": "2025-01",
		"persons": []any{
			map[string]any{"id": "p1", "name": "You", "role": "primary", "birth_month": "1958-11"},
			map[string]any{"id": "p2", "name": "Spouse", "role": "spouse", "birth_month": "1971-08"},
		},
		"healthcare_persons": []any{
			map[string]any{"id": "h1", "name": "Darrell", "person_id": "p1", "birth_month": "1958-11", "current_age": 66, "current_coverage": "medicare", "current_monthly_cost": 500, "pre_medicare_inflation": 7, "medicare_monthly_cost": 400, "post_medicare_inflation": 4.5, "medicare_eligible_age": 65},
			map[string]any{"id": "h2", "name": "Christine", "person_id": "p2", "birth_month": "1971-08", "current_age": 53, "current_coverage": "aca", "current_monthly_cost": 500, "pre_medicare_inflation": 7, "medicare_monthly_cost": 400, "post_medicare_inflation": 4.5, "medicare_eligible_age": 65},
		},
	}
	dir, sm := newRoot(t, map[string]map[string]any{"whatif.json": raw})
	path := filepath.Join(dir, "whatif.json")
	// Warm the file through one load+save so only the flag/date could differ.
	first, err := sm.Load()
	if err != nil {
		t.Fatal(err)
	}
	if first.StartDate != nowMonth() {
		t.Fatalf("F1 start_date = %q, want %q", first.StartDate, nowMonth())
	}
	before, _ := os.ReadFile(path)
	beforeRaw := readRaw(t, path)
	if beforeRaw["use_current_month"] == true && beforeRaw["start_date"] == nowMonth() {
		// A save happened on the first load with nothing to migrate.
		t.Errorf("F2 load rewrote a plan that needed no migration: %v %v", beforeRaw["use_current_month"], beforeRaw["start_date"])
	}
	sm.InvalidateCache()
	if _, err := sm.Load(); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Errorf("F3 second load rewrote the file")
	}
}
