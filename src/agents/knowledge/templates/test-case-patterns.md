# Test Case Patterns Bank

Generic patterns for converting any user story into structured test cases.

---

## Test Case Types

| Type | Tag | When to Generate |
|------|-----|------------------|
| Happy Path | `@smoke @e2e` | Primary success flow from the story |
| Negative | `@negative @regression` | Invalid inputs, missing data, unauthorized access |
| Edge Case | `@negative @regression` | Boundary values, max lengths, special characters |
| Validation | `@negative @regression` | Form field validation rules |

---

## Pattern: User Account Creation

**Happy path:** Navigate → Fill form with ##random data → Submit → Verify success → Store + Persist credentials

**Negative cases:**
- Submit empty form → verify all required field errors
- Submit with invalid email format → verify email error
- Submit with duplicate email → verify already exists error
- Submit with short/weak password → verify password requirements error
- Submit with excessively long inputs → verify length limit

**Critical rule:** ALWAYS store + persist registration data (email, password, name) — downstream scenarios will need them.

---

## Pattern: Authentication (Login)

**Happy path:** Navigate → Enter $$persisted credentials → Submit → Verify logged-in state

**Negative cases:**
- Empty credentials → verify required errors
- Wrong password → verify auth failure
- Non-existent user → verify user not found
- SQL injection attempt → verify no bypass

---

## Pattern: Form Submission (Any)

**Happy path:** Navigate → Fill all fields → Submit → Verify success

**Negative cases (generate per field):**
- Leave required field empty → verify specific field error
- Enter invalid format (wrong email, letters in phone) → verify format error
- Exceed max length → verify length error
- Special characters where not allowed → verify character error

**Rule:** For each REQUIRED field in the form, generate one negative case.

---

## Pattern: Multi-Step Wizard

**Happy path:** Step 1 (fill + next) → Step 2 (fill + next) → ... → Final step (submit) → Success

**Negative cases:**
- Submit Step 1 empty → verify all validation errors at Step 1
- Enter invalid date/format at relevant step → verify format error
- Skip required selection → verify selection error

---

## Pattern: CRUD Operations (Web UI)

**Create:** Navigate to form → Fill → Submit → Verify created + capture ID
**Read:** Navigate to list → Verify item visible → Click to view details → Verify details
**Update:** Navigate to item → Click edit → Modify fields → Save → Verify changes
**Delete:** Navigate to item → Click delete → Confirm → Verify removed

---

## Pattern: CRUD Operations (REST API)

**Create (POST):**
```
When I send a POST request to '/resource' with body:
  | key   | value |
Then the response status should be 201
And the response body field 'id' should exist
```

**Read (GET):**
```
When I send a GET request to '/resource/id'
Then the response status should be 200
And the response body field 'fieldName' should equal 'expectedValue'
```

**Update (PUT):**
```
When I send a PUT request to '/resource/id' with body:
  | key   | value   |
Then the response status should be 200
```

**Delete (DELETE):**
```
When I send a DELETE request to '/resource/id'
Then the response status should be 200
```

**API Negative cases:**
- GET non-existent resource → 404
- POST with missing required fields → 400 or 422
- POST with invalid data types → 400
- DELETE non-existent resource → 404
- Unauthorized request (no/bad token) → 401 or 403

---

## Pattern: Search and Filter

**Happy path:** Navigate → Enter search term → Submit → Verify results match

**Negative cases:**
- Empty search → verify all results or "enter search term" message
- Search with no results → verify "no results" message
- Search with special characters → verify handled gracefully

---

## Pattern: Navigation and Menu

**Happy path:** Verify menu items visible → Click item → Verify correct page loads

**Negative cases:**
- Access restricted page without login → verify redirect to login
- Access non-existent route → verify 404 or redirect

---

## Negative Test Generation Rules

1. **One failure condition per scenario** — test ONE invalid input at a time
2. **Always end with assertion** — prove the error state (message visible, URL unchanged)
3. **Use realistic wrong values** — not 'aaa' but 'invalid@' or 'wrongpass'
4. **Never use $$variables in negative tests** — those are real/valid credentials
5. **Keep scenarios short** — 4-6 steps max (navigate, enter bad data, submit, verify error)
6. **Name describes the failure** — "Login with empty password", "Submit form without email"

---

## Data Selection Rules

When a story uses GENERAL terms (e.g., "Enter a city into the City field", "Select a Country"), YOU decide the data based on field nature.

### DYNAMIC (random, unique per run) — use ## tokens
These MUST be unique each run to avoid conflicts (duplicate account, etc.):

| Field | Token | Reason |
|-------|-------|--------|
| Full name | `##FullName` | Unique person |
| First name | `##FirstName` | Unique person |
| Last name | `##LastName` | Unique person |
| Email | `##Email` | Must be unique — duplicate registration fails |
| Username | `##Username` | Must be unique |
| Password | `##Password` | Random secure value |
| Phone / Mobile | `##MobileNum` | Unique contact |
| Company | `##Company` | Random company name |
| Address (street) | `##Address` | Random street address |

### STATIC (fixed literal values) — do NOT randomize
These are fixed choices or formats — randomizing breaks dropdown selection or validation:

| Field | Use Literal | Reason |
|-------|-------------|--------|
| City | `Bangalore` | Fixed value — avoids invalid city |
| State | `Karnataka` | Fixed value |
| Country | `India` | Must match a dropdown option exactly |
| Zipcode / Postal | `560001` | Fixed valid format |
| Date of Birth | `15` / `May` / `1990` (or `1990-05-15`) | Fixed date; dropdowns need exact option text |
| Gender / Title | `Male` / `Mr.` | Must match radio/dropdown option |
| ID Type | `Aadhaar` / `Passport` | Must match dropdown option |
| ID Number | `123456789012` | Fixed valid format |
| Plan / Product selections | Exact name from UI | Must match displayed option |

### Rules
1. **Unique-required fields → `##token`** (name, email, phone, username, company, address)
2. **Fixed-choice / dropdown fields → literal value** (city, state, country, gender, DOB, plan)
3. **Never randomize dropdown values** — a random country won't match any `<option>`
4. **Date dropdowns (Day/Month/Year)** → use literals matching the option text: Day `15`, Month `May`, Year `1990`
5. When story says "Select a Country" → pick a common valid one like `India` or `United States` (literal)
6. When story says "Enter a city" → use a realistic literal like `Bangalore` (not `##City` — city rarely needs uniqueness and random cities may be rejected)
