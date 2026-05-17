# Playwright BDD Framework

A production-grade, 2-layer BDD automation framework for **Web UI** and **REST API** testing using:

- **Playwright** — Cross-browser web automation
- **Cucumber (BDD)** — Human-readable `.feature` files
- **TypeScript** — Strict typing throughout
- **Allure + HTML** — Rich reporting

---

## Core Concept: 2-Step Automation

```
Step 1 → Write the Feature File (Gherkin)       [ You write this ]
Step 2 → Map elements in .properties files       [ You write this ]
         The framework does the rest              [ Framework handles this ]
```

### Example Feature File

```gherkin
When I click 'Home.Logo'
When I enter 'standard_user' into 'Login.UsernameField'
Then 'Login.ErrorMessage' should be visible
```

### Corresponding Properties File (`Login.properties`)

```properties
UsernameField=#user-name
PasswordField=#password
LoginButton=#login-button
ErrorMessage=[data-test='error']
```

**That's it.** No code changes needed. Add a new element → add one line to the `.properties` file.

---

## Project Structure

```
testusplay/
├── features/
│   ├── web/
│   │   ├── home.feature          ← Web UI scenarios
│   │   └── hybrid.feature        ← Mixed web + API scenarios
│   └── api/
│       └── users.feature         ← Pure API scenarios
│
├── src/
│   ├── core/
│   │   ├── ElementResolver.ts    ← Resolves 'Page.Element' → locator string
│   │   ├── ActionEngine.ts       ← All web actions (click, enter, assert…)
│   │   ├── ApiEngine.ts          ← HTTP client (GET, POST, PUT, PATCH, DELETE)
│   │   ├── ContextManager.ts     ← Browser / Page lifecycle management
│   │   └── CustomWorld.ts        ← Cucumber World (shared context per scenario)
│   │
│   ├── pages/
│   │   └── properties/           ← Element locator files
│   │       ├── Home.properties
│   │       ├── Login.properties
│   │       ├── Cart.properties
│   │       └── Checkout.properties
│   │
│   ├── steps/
│   │   ├── WebSteps.ts           ← Web BDD step implementations
│   │   ├── ApiSteps.ts           ← API BDD step implementations
│   │   └── CommonSteps.ts        ← Shared steps (variables, data, logging)
│   │
│   ├── hooks/
│   │   └── Hooks.ts              ← Before/After scenario/step hooks
│   │
│   ├── config/
│   │   └── environments.ts       ← Multi-environment configuration
│   │
│   └── utils/
│       ├── Logger.ts             ← Winston-based structured logging
│       ├── DataStore.ts          ← In-scenario key-value store
│       ├── TestDataLoader.ts     ← Load JSON test data files
│       ├── ResponseValidator.ts  ← API response assertion helpers
│       └── GenerateReport.js     ← HTML report generator
│
├── testdata/
│   ├── users.json                ← UI test credentials
│   └── api.json                  ← API test payloads
│
├── reports/                      ← Auto-generated (git-ignored)
├── .env                          ← Environment variables (git-ignored)
├── .env.example                  ← Template for .env
├── cucumber.js                   ← Cucumber profiles
├── tsconfig.json
└── package.json
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
npx playwright install --with-deps
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Run tests

```bash
# All tests
npm test

# Web tests only
npm run test:web

# API tests only
npm run test:api

# Smoke tests
npm run test:smoke

# Specific feature file
npx cucumber-js features/web/home.feature

# Specific tag
npx cucumber-js --tags "@checkout and not @ignore"
```

### 4. Generate report

```bash
npm run report
# Open reports/html/index.html
```

---

## Creating New Pages

### Step 1: Create a properties file

`src/pages/properties/ProductDetail.properties`

```properties
# Product Detail Page Elements
ProductTitle=.inventory_details_name
ProductDescription=.inventory_details_desc
ProductPrice=.inventory_details_price
ProductImage=.inventory_details_img
AddToCartButton=text=Add to cart
BackButton=text=Back to products
```

### Step 2: Use in feature file immediately

```gherkin
When I click 'ProductDetail.AddToCartButton'
Then 'ProductDetail.ProductTitle' should be visible
And I store text of 'ProductDetail.ProductPrice' as 'price'
```

**No TypeScript changes needed.**

---

## Locator Types Supported

| Format | Example | When to Use |
|--------|---------|-------------|
| CSS Selector | `.class-name`, `#id`, `[attr='val']` | Most elements |
| XPath | `//button[@text='Submit']` | Complex DOM traversal |
| Text | `text=Sign In` | Elements with unique text |
| Placeholder | `placeholder=Enter email` | Input fields |
| Role | `role=button[name='Submit']` | ARIA-accessible elements |
| Test ID | `data-testid=submit-btn` | Elements with test IDs |
| Chained | `.nav >> .logo` | Scoped child locators |

---

## Web Step Reference

### Navigation
```gherkin
Given I navigate to 'https://example.com'
Given I am on the base url
When I go back
When I go forward
When I refresh the page
```

### Interactions
```gherkin
When I click 'Page.Element'
When I double click 'Page.Element'
When I right click 'Page.Element'
When I enter 'value' into 'Page.Element'
When I type 'value' into 'Page.Element'
When I press 'Enter' on 'Page.Element'
When I press 'Tab'
When I select 'Option Label' from 'Page.Element'
When I check 'Page.Checkbox'
When I uncheck 'Page.Checkbox'
When I hover over 'Page.Element'
When I scroll to 'Page.Element'
When I drag 'Page.SourceEl' to 'Page.TargetEl'
When I upload file 'path/to/file.pdf' to 'Page.FileInput'
```

### Assertions
```gherkin
Then 'Page.Element' should be visible
Then 'Page.Element' should be hidden
Then 'Page.Element' should have text 'Expected Text'
Then 'Page.Element' should contain text 'partial'
Then 'Page.Element' should have value 'input value'
Then 'Page.Element' should be enabled
Then 'Page.Element' should be disabled
Then 'Page.Element' should be checked
Then 'Page.Element' should have 5 items
Then 'Page.Element' should have attribute 'href' with value '/home'
Then the page title should be 'Page Title'
Then the url should contain 'dashboard'
```

### Data Capture & Variables
```gherkin
When I store text of 'Page.Element' as 'myVar'
When I store attribute 'href' of 'Page.Element' as 'myVar'
Given I set variable 'username' to 'john_doe'
# Use variables in any step with {variableName}
When I enter '{username}' into 'Login.UsernameField'
```

### Forms (DataTable)
```gherkin
When I fill the form:
  | Login.UsernameField | standard_user |
  | Login.PasswordField | secret_sauce  |

When I click the following elements:
  | Home.MenuButton |
  | Home.LogoutLink |
```

---

## API Step Reference

### Requests
```gherkin
Given I set the base url to 'https://api.example.com'
Given I set bearer token 'my-token'
Given I set bearer token '{authToken}'   ← use stored variable
Given I set api key 'my-key' in header 'x-api-key'

When I send a GET request to '/users/1'
When I send a DELETE request to '/users/{userId}'
When I send a GET request to '/users' with query params:
  | page     | 2 |
  | per_page | 5 |

When I send a POST request to '/users' with body:
  | key  | value |
  | name | John  |
  | job  | Dev   |

When I send a PUT request to '/users/1' with body:
  | key | value |
  | job | Lead  |
```

### Assertions
```gherkin
Then the response status should be 200
Then the response status should be in range 200 to 299
Then the response header 'content-type' should contain 'application/json'
Then the response body field 'data.first_name' should equal 'Janet'
Then the response body field 'message' should contain 'success'
Then the response body field 'token' should exist
Then the response body field 'email' should not be empty
Then the response body field 'data' should be an array with 6 items
Then the response body field 'results' should not be empty array
Then the response time should be less than 2000ms
```

### Capture
```gherkin
And I store the response body field 'id' as 'userId'
And I store the response body field 'token' as 'authToken'
# Now use in next request:
When I send a GET request to '/users/{userId}'
Given I set bearer token '{authToken}'
```

---

## Environment Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENV` | `qa` | Target environment: `dev`, `qa`, `staging`, `prod` |
| `BROWSER` | `chromium` | Browser: `chromium`, `firefox`, `webkit` |
| `HEADLESS` | `false` | Run headless: `true` or `false` |
| `BASE_URL_QA` | saucedemo.com | Web base URL for QA |
| `API_BASE_URL_QA` | reqres.in | API base URL for QA |
| `DEFAULT_TIMEOUT` | `30000` | Element wait timeout (ms) |
| `SCREENSHOT_ON_FAIL` | `true` | Auto screenshot on failure |
| `VIDEO` | `retain-on-failure` | Video: `on`, `off`, `retain-on-failure` |

---

## Tags

| Tag | Purpose |
|-----|---------|
| `@web` | Web UI scenarios (launches browser) |
| `@api` | API-only scenarios (no browser) |
| `@smoke` | Smoke test suite |
| `@regression` | Full regression suite |
| `@negative` | Negative / error path tests |
| `@ignore` | Skip this scenario |
| `@slow` | Extended timeout warning |

---

## Reports

After running tests:

| Report | Location |
|--------|----------|
| HTML Report | `reports/html/index.html` |
| JSON Report | `reports/cucumber-json/cucumber-report.json` |
| Allure Results | `reports/allure-results/` |
| Logs | `reports/logs/test-run.log` |
| Screenshots | `reports/screenshots/` |
| Videos | `reports/videos/` |

To view Allure report:
```bash
npx allure serve reports/allure-results
```
