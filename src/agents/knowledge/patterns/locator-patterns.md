# Locator Patterns Bank

How element locators should be structured in .properties files for any application.

---

## Locator Priority (highest stability first)

| Priority | Type | Pattern | Stability |
|----------|------|---------|-----------|
| 1 | data-testid | `//element[@data-testid='value']` | Highest — designed for testing |
| 2 | data-test | `//element[@data-test='value']` | Same as above |
| 3 | data-qa | `//element[@data-qa='value']` | Same as above |
| 4 | data-cy | `//element[@data-cy='value']` | Same as above |
| 5 | Unique ID | `#element-id` | High — if ID is stable |
| 6 | ARIA role+name | `role=button[name='Submit']` | High — accessibility based |
| 7 | Placeholder | `placeholder=Enter email` | Medium — user-facing text |
| 8 | CSS selector | `.unique-class` | Medium — depends on app |
| 9 | XPath | `//tag[@attr='value']` | Medium — attribute based |
| 10 | Text content | `text=Button Label` | Low — changes with i18n |

**Rule:** Always use the highest available priority. If element has `data-testid`, NEVER use placeholder or text as locator.

---

## Properties File Format

```properties
# PageName - Section Name
ElementKey=locator_string

# One element per line
# Key = PascalCase with type prefix
# Value = Playwright-compatible locator
# Comments start with #
```

---

## Naming Conventions

| Element Type | Prefix | Examples |
|-------------|--------|----------|
| Buttons | `Btn` | BtnSubmit, BtnNext, BtnCancel, BtnSave |
| Input fields | `Input` | InputEmail, InputPhone, InputSearch |
| Select/Dropdown | `Select` | SelectCountry, SelectState, SelectRole |
| Navigation links | `Nav` | NavDashboard, NavOrders, NavSettings |
| Headings/Labels | Descriptive | WelcomeHeading, PageTitle, StepBadge |
| Error messages | `Error` | ErrorEmail, ErrorPassword, ErrorName |
| Checkboxes | `Checkbox` | CheckboxTerms, CheckboxNewsletter |
| Radio buttons | `Radio` | RadioMale, RadioFemale, RadioPremium |
| Status indicators | `Stat` / `Status` | StatTotal, StatusApproved |
| Cards/Items | Descriptive | ProductCard, OrderItem, TicketRow |
| Modals/Popups | Descriptive | ModalConfirm, PopupSuccess, DialogDelete |
| Tables | `Table` / Descriptive | TableOrders, CartTable |

---

## File Organization

```properties
# PageName - Authentication
InputEmail=//input[@data-testid='input-email']
InputPassword=//input[@data-testid='input-password']
BtnLogin=//button[@data-testid='btn-login']
BtnRegister=//button[@data-testid='btn-register']

# PageName - Navigation
NavHome=role=link[name='Home']
NavProducts=role=link[name='Products']
NavOrders=role=link[name='Orders']

# PageName - Form Fields
InputFirstName=//input[@data-testid='first-name']
InputLastName=//input[@data-testid='last-name']
SelectCountry=//select[@data-testid='country']

# PageName - Actions
BtnSubmit=//button[@data-testid='btn-submit']
BtnNext=//button[@data-testid='btn-next']
BtnCancel=//button[@data-testid='btn-cancel']

# PageName - Verification
SuccessMessage=//div[@data-testid='success-msg']
ErrorMessage=//p[@data-testid='error-msg']
StatusLabel=//span[@data-testid='status']
```

---

## Locator Rules

1. **Case-exact:** `placeholder=Username` (capital U) — must match DOM exactly
2. **No duplicates:** Each key must be unique within a file
3. **Prefer stability:** `data-testid` over `text=` (text changes, testids don't)
4. **One locator per element:** Don't create multiple keys for the same DOM element
5. **Readable keys:** Key should tell you WHAT the element is without reading the locator
6. **Group by function:** Authentication, Navigation, Form, Actions, Verification sections

---

## Supported Locator Formats

| Format | Example | Engine |
|--------|---------|--------|
| XPath | `//button[@data-testid='submit']` | Playwright XPath |
| CSS ID | `#login-form` | CSS selector |
| CSS Class | `.btn-primary` | CSS selector |
| Attribute | `[data-testid='value']` | CSS selector |
| Role | `role=button[name='Login']` | Playwright role locator |
| Placeholder | `placeholder=Enter email` | Playwright placeholder locator |
| Text | `text=Click here` | Playwright text locator |
| Chained | `parent >> child` | Playwright chained |

---

## When to Create a New Properties File

- One `.properties` file per logical PAGE or MODULE
- If a flow spans multiple pages, put ALL elements in ONE file (named after the flow)
- Don't create separate files for login vs dashboard if they're part of the same flow

---

## What NOT to Put in Properties Files

- Dynamic content (order IDs, timestamps) — these are captured at runtime
- Elements that only exist in specific states (use the closest stable parent)
- Duplicate entries for the same DOM element with different keys
