<!-- triggers: ecommerce, e-commerce, cart, checkout, product, shopping, automationexercise, storefront, catalog -->

# E-Commerce Domain Knowledge

Domain knowledge for automating online storefronts (register → login → browse →
add to cart → checkout). Use it for domain-aware test cases, realistic data, and
assertions. This file is PATTERNS ONLY — it does NOT contain locators. Capture real
locators per app via Playwright MCP into the app's `.properties` file before generating.

---

## Actors / Roles

| Role | Description |
|------|-------------|
| Visitor / Guest | Unauthenticated user browsing products |
| Registered Customer | Signed-up user who can order and track purchases |
| (optional) Admin | Manages catalog / orders (back office) |

---

## Core Shopping Journey

```
Home → Signup/Login → Register → Logged in → Browse/Search → Add to cart → Cart → Checkout → Confirmation
```

| Stage | Typical assertions |
|-------|--------------------|
| Signup/Login | Register form / "Enter Account Information" shown |
| Registration | URL contains signup; "Account Created" on submit |
| Account Created | Success heading visible; Continue proceeds |
| Logged in | Nav shows "Logged in as <name>" |
| Products | Product list / target product visible |
| Add to cart | "Added" modal visible OR cart badge increments |
| Cart | Cart lists the added product (name/qty/price) |
| Checkout | Order confirmation / order number |

---

## E-Commerce Field Semantics & Test Data

Choose data by field nature — unique fields random (`##`), constrained values static.

| Field | Strategy | Notes |
|-------|----------|-------|
| Name / First / Last | `##FirstName` / `##LastName` / `##FullName` | Unique |
| Email | `##Email` | Unique; account identifier |
| Password | `##Password` | Satisfy site min-length |
| Address / Company | `##Address` / `##Company` | Free-text |
| City / State | `##City` / static | State often free-text or select |
| Zipcode | `##ZipCode` | Match locale format |
| Mobile Number | `##MobileNum` | Digits only |
| Title (Mr./Mrs.) | static literal | Radio/select, fixed list |
| Day / Month / Year (DOB) | static literals | Selects; pick valid values |
| Newsletter / Offers | checkbox | Check/uncheck per scenario |
| Country | static literal | Select from fixed list |
| Quantity | static integer | Boundary: 0, 1, max |

---

## Assertion Guidance

| Scenario | Assertion approach |
|----------|--------------------|
| Registration success | Success heading visible + URL contains confirmation path |
| Logged in | Nav shows "Logged in as <name>" (contains text) |
| Add to cart | Confirmation modal visible OR cart badge count increases |
| Cart contents | Product name present in the cart list (`should contain text`) |
| Price / total | Assert exact total only when quantity + unit price are known |
| Empty cart | Empty-cart message / zero badge |

- Use `should contain text` for product names and "Logged in as" labels.
- Use `should be visible` for confirmation modals/headings.
- Assert cart totals exactly only when the math is deterministic; otherwise assert the
  item is present.

---

## Common E-Commerce Negative / Edge Cases

Generate from the app's REAL validation — never invent messages/URLs:

- Register with an already-registered email; password below min length
- Missing required registration fields; invalid email format
- Add to cart while logged out (if login is required)
- Quantity set to 0 / negative / huge; checkout with empty cart or missing address/payment

**Rule:** For unknown copy/routes, assert the flow does NOT advance (stays on the same
page/step, form still shown) rather than guessing an error string.

---

## Locator Discovery Note (IMPORTANT)

E-commerce sites vary widely and rarely share locators. Do NOT reuse locators from a
different store's `.properties` file (e.g. a Swag Labs/SauceDemo map does not apply to
automationexercise.com). Always capture the target site's real locators via Playwright
MCP into that app's own `.properties` file before generating steps.
