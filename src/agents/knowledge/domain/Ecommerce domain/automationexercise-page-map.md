<!-- triggers: automationexercise, automation exercise, blue top -->

# AutomationExercise — Page Map (verified DOM)

Distilled structure for automationexercise.com (register → login → add to cart).
Element keys map to `'AutomationExercise.<Key>'` (see `AutomationExercise.properties`).
This site uses **data-qa** attributes (NOT data-testid). Captured from the live DOM.

### Home / Nav (`/`)
- `NavSignupLogin` (/login), `NavProducts` (/products), `NavCart` (/view_cart).
- After login, nav shows `LoggedInAs` ("Logged in as <name>") and `NavLogout`/`NavDeleteAccount`.

### Signup / Login page (`/login`)
- Two forms on one page.
- New User Signup: `InputSignupName`, `InputSignupEmail` → `BtnSignup` (→ `/signup`).
- Login: `InputLoginEmail`, `InputLoginPassword` → `BtnLogin`.
- Advance (signup): name + email → `BtnSignup` navigates to the registration form.

### Registration form (`/signup`) — "Enter Account Information"
- Title radios: `RadioTitleMr` (id_gender1) / `RadioTitleMrs` (id_gender2).
- `InputPassword`; DOB selects `SelectDay` / `SelectMonth` / `SelectYear` (native selects).
- Checkboxes: `CheckboxNewsletter`, `CheckboxOffers`.
- Address: `InputFirstName`, `InputLastName`, `InputCompany`, `InputAddress`, `InputAddress2`,
  `SelectCountry` (native select), `InputState`, `InputCity`, `InputZipcode`, `InputMobileNumber`.
- `BtnCreateAccount` submits → `/account_created`.

### Account Created (`/account_created`)
- `HeadingAccountCreated` ("Account Created!") visible on success.
- `BtnContinue` proceeds (logs the user in).

### Products (`/products`)
- Products are cards; add-to-cart links carry `data-product-id`.
- Blue Top = product id 1 → `BtnAddToCartBlueTop`
  (`//a[@data-product-id='1' and contains(@class,'add-to-cart')]`).
- Clicking add-to-cart opens `CartModal` (#cartModal):
  - `CartModalAddedHeading` ("Added!"), `CartModalBody` ("...has been added to cart."),
    `LinkViewCart` (→ /view_cart).

### Cart (`/view_cart`)
- Each product sits in a row `#product-<id>`; Blue Top → `CartProductBlueTop`.
- `BtnProceedToCheckout` continues to checkout.

### Data & assertion notes
- Name/email/password/address → random `##` tokens (unique). Title, DOB day/month/year,
  country → static valid literals (fixed lists).
- Assert registration success via `HeadingAccountCreated` visible + URL contains
  `/account_created`. Assert add-to-cart via `CartModalAddedHeading` visible. Assert cart
  via `CartProductBlueTop` present (`should contain text 'Blue Top'`).
- For negatives, prefer "flow did not advance" (still on same page/form) over guessed messages.

### Quick reference — dynamic locators
| Concern | Rule |
|---------|------|
| Attribute system | data-qa (not data-testid) |
| Two forms on /login | Use signup-* vs login-* data-qa to disambiguate |
| Product add-to-cart | Keyed by data-product-id (Blue Top = 1) |
| Cart rows | Keyed by row id `product-<id>` |
