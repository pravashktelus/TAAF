<!-- triggers: telecom, broadband, teleconnect, telecrm, teleinstall, teleactivate, televerify -->

# Telecom Domain — Test Data & Validation

Field-level data strategy, ID formats, and negative/edge guidance for telecom flows.

---

## Field Semantics & Realistic Test Data

Choose data by the NATURE of the field. Unique fields → random (`##`); constrained
domain values → static, realistic literals.

| Field | Strategy | Example / Notes |
|-------|----------|-----------------|
| Full Name | `##FullName` | Unique each run |
| Email | `##Email` | Unique; account identifier |
| Password | `##Password` | Must satisfy min length (commonly min 6) |
| Phone / Alt Phone | `##PhoneNum` | 10-digit national format |
| Date of Birth | static literal | e.g. `1990-05-15`; adult age required |
| Gender | static literal | Fixed list (Male / Female / Other) |
| Residential / Install Address | `##Address` | Free-text |
| State | static literal | Fixed list (Delhi, Maharashtra, Karnataka, ...) |
| City | static literal | Depends on State (cascading) |
| Area | static literal | Depends on City (cascading) |
| Pincode | auto-filled | Derived from Area — do not type manually |
| ID Type | static literal | Aadhaar / PAN / Passport / Driving License |
| ID Number | static literal | Must match ID Type format (below) |
| Preferred Date | static / relative | Future date; format `YYYY-MM-DD` |
| Time Slot | static literal | Morning / Afternoon / Evening |

---

## Identity Document Formats (India-centric KYC)

| ID Type | Format | Example |
|---------|--------|---------|
| Aadhaar | 12 digits | `123456789012` |
| PAN | 5 letters + 4 digits + 1 letter | `ABCDE1234F` |
| Passport | 1 letter + 7 digits | `A1234567` |
| Driving License | state code + number | `DL0420110012345` |

---

## Assertion Guidance

| Scenario | Assertion approach |
|----------|--------------------|
| Order placed | Order success section + order number visible (not exact value) |
| Order status | Status text has expected value (PLACED/APPROVED/...); optionally color |
| Plan/offer selection | Selected card shows active state; price summary updates |
| Cascading location | After selecting State, City options become available |
| KYC / ID | Invalid ID format → field-level error; valid → advances |
| Installation schedule | Selected slot highlighted; expected date shown on success |

- Strong assertions (`should have text`) for known fixed labels/status values.
- `should contain text` for step indicators ("Step 3") and partial matches.
- `should be visible` for dynamically generated values (order numbers, dates).

---

## Negative / Edge Cases

Generate these from the app's REAL validation rules — never invent messages/URLs:

- Registration with password below minimum length
- Missing required KYC fields (Name, Email, Phone, ID)
- Invalid ID number format for the selected ID Type (e.g. PAN with wrong pattern)
- Selecting City/Area before State (cascading dependency not satisfied)
- Past date for preferred installation date
- Submitting a wizard step with required fields empty
- Duplicate registration with an already-used email

**Rule:** Only assert specific error text / redirect URLs confirmed from the live app or
its source. If unknown, assert the flow does NOT advance (stays on the same step / URL)
rather than guessing a message.
