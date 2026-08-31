# Domain Knowledge Bank

General knowledge for automating any enterprise-grade web or API application.

---

## Framework Architecture

```
Layer 1: Feature Files (.feature)       → BDD scenarios (Gherkin syntax)
Layer 2: Element Locators (.properties) → Key=Locator mappings per page
Layer 3: Step Definitions (.ts)         → Generic reusable step implementations
```

- No page object classes needed — elements are referenced as `'PageName.ElementKey'`
- Step definitions are GENERIC — they handle any application without custom code
- Self-Healing Engine auto-recovers locator drift at runtime
- Supports Web UI (Playwright) + REST API (Axios) testing

---

## Test Data Strategy

| Syntax | Purpose | When to Use |
|--------|---------|-------------|
| `##FieldName` | Random data (Faker.js) | Creating new/unique data (registration, form fills) |
| `{variableName}` | Scenario variable | Referencing data captured earlier in SAME scenario |
| `$$variableName` | Cross-scenario variable | Referencing data persisted from a PREVIOUS scenario |

### Available ## Tokens
`##FullName`, `##FirstName`, `##LastName`, `##Email`, `##Username`, `##Password`, `##MobileNum`, `##PhoneNum`, `##Address`, `##City`, `##State`, `##ZipCode`, `##Country`, `##Company`, `##JobTitle`, `##DOB`, `##SSN`, `##CreditCard`, `##Amount`, `##UUID`

### Data Flow Between Scenarios
```
Scenario 1 (creates data):
  Enter ##Email → store attribute 'value' → persist as 'Email'

Scenario 2 (uses data):
  Enter $$Email → resolved from runtime-store.json
```

---

## Cross-Scenario Data Capture Pattern

When a scenario generates data needed by later scenarios:

```gherkin
# Capture input field value (after entering random data)
And I store attribute 'value' of 'Page.InputField' as 'VarName'
And I persist '{VarName}' as 'VarName'

# Capture displayed text (order IDs, ticket numbers, etc.)
And I get text from 'Page.DisplayElement' and store as 'VarName'
And I persist '{VarName}' as 'VarName'
```

**Rule:** If you enter `##random` data into a field that other scenarios will need, you MUST store + persist it.

---

## Application Authentication Patterns

| Pattern | Approach |
|---------|----------|
| New user registration | Use `##Email`, `##Password` → store + persist for future login |
| Login with existing creds | Use `$$Email`, `$$Password` (from persisted store) |
| Login with static test creds | Use literal values (for demo/shared accounts) |
| No authentication needed | Skip login — navigate directly to target page |
| Session-based (CRM/admin) | Use quick-login buttons or separate auth flow |

---

## Page Transition Detection

After any click that causes navigation:
1. Verify URL contains expected fragment
2. Verify a key element on the new page is visible

```gherkin
When I click 'Page.NavOrders'
Then the url should contain '/orders'
And 'Page.OrdersHeading' should be visible
```

---

## Multi-Step Form (Wizard) Pattern

For applications with step-by-step forms:
1. Verify step indicator at each stage
2. Test empty submission (negative validation) at Step 1
3. Fill required fields → advance
4. On final step: submit → verify success

---

## Error Validation Pattern

When testing form validation:
- Submit with empty/invalid fields FIRST (negative)
- Verify EACH error message with exact text
- Then fill correctly and submit (positive)

---

## Enterprise Application Common Patterns

| Pattern | Description |
|---------|-------------|
| CRUD operations | Create, Read, Update, Delete — test each independently |
| Role-based access | Different users see different UI — test per role |
| Data dependency chains | Order → Invoice → Payment — each depends on previous |
| Search and filter | Enter criteria, submit, verify filtered results |
| Bulk operations | Select multiple items, perform action, verify all updated |
| Export/Download | Trigger export, verify file generated (limited to UI verification) |
| Notifications/Alerts | After actions, verify toast/alert messages appear |
| Pagination | Navigate through pages, verify data loads correctly |
| Modal/Dialog flows | Click trigger → verify modal opens → interact → verify closes |
