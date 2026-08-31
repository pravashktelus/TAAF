# Step Definitions Reference

Complete reference of all available step patterns. Use ONLY these — never invent new steps.

---

## Navigation Steps

| Step | When to Use |
|------|-------------|
| `Given I navigate to the application` | Start of every web scenario (navigates to app.url) |
| `Given I navigate to 'https://...'` | Navigate to a specific URL |
| `When I go back` | Browser back button |
| `When I refresh the page` | Reload current page |

---

## Interaction Steps

| Step | When to Use |
|------|-------------|
| `When I click 'Page.Element'` | Click any button, link, card, radio |
| `When I enter 'value' into 'Page.Element'` | Type text into input/textarea (clears first) |
| `When I select 'Option' from 'Page.Element'` | Native HTML `<select>` dropdown — select by visible text |
| `When I select 'Option' from dropdown 'Page.Element'` | Custom combobox/dropdown (non-native) |
| `When I check 'Page.Element'` | Check a checkbox |
| `When I hover over 'Page.Element'` | Mouse hover |
| `When I scroll to 'Page.Element'` | Scroll element into view |
| `When I upload file 'path' to 'Page.Element'` | File upload input |
| `When I drag 'Page.Source' to 'Page.Target'` | Drag and drop |

**IMPORTANT:**
- `I enter` clears the field first then types. Use for ALL text input.
- `I select ... from` is for native `<select>` elements. Use for ALL dropdowns unless explicitly custom.
- `I select ... from dropdown` is ONLY for custom combobox components (rare).
- `I click` works for buttons, links, divs, cards — anything clickable.

---

## Assertion Steps

| Step | When to Use | Matching Type |
|------|-------------|---------------|
| `Then 'Page.El' should be visible` | Verify element exists on page | Existence only |
| `Then 'Page.El' should be hidden` | Verify element NOT visible | Inverse existence |
| `Then 'Page.El' should have text 'exact'` | Verify EXACT text match | Strict equality |
| `Then 'Page.El' should contain text 'partial'` | Verify text CONTAINS fragment | Substring match |
| `Then 'Page.El' should have value 'val'` | Verify input field value | For form inputs |
| `Then 'Page.El' should be enabled` | Verify button/input is enabled | Clickable state |
| `Then 'Page.El' should be disabled` | Verify button/input is disabled | Non-clickable state |
| `Then the url should contain 'fragment'` | Verify current URL | After navigation |
| `Then the page title should be 'Title'` | Verify page title | Rarely needed |

**When to use which assertion:**
- `should have text` — when you know the EXACT text (error messages, headings, status labels)
- `should contain text` — when element has MORE text than what you're checking (badges like "Step 1 of 6")
- `should be visible` — when you just need to confirm something appeared (success section, modal)
- `url should contain` — after any click that navigates to a new page

---

## Data Capture Steps

| Step | When to Use |
|------|-------------|
| `When I get text from 'Page.El' and store as 'varName'` | Capture visible text (order numbers, IDs) |
| `When I store text of 'Page.El' as 'varName'` | Same as above (alias) |
| `When I store attribute 'value' of 'Page.El' as 'varName'` | Capture input field VALUE (after entering ##random) |
| `Given I set variable 'name' to 'value'` | Set a variable to a static value |
| `When I persist '{varName}' as 'varName'` | Save to runtime-store.json for cross-scenario |
| `Then I attach 'varName' to the report as 'Label'` | Add to test report output |

**Data Capture Rules:**
1. After entering `##random` into a field → ALWAYS `store attribute 'value'` + `persist`
2. After order/ticket creation → ALWAYS `get text from` the ID element + `persist`
3. Use `store attribute 'value'` for INPUT fields (where text is in the value attribute)
4. Use `get text from` for display elements (paragraphs, spans, headings)

---

## API Steps

| Step | When to Use |
|------|-------------|
| `Given I set the base url to 'url'` | Set API base URL (use in Background) |
| `Given I set bearer token 'token'` | Set auth token |
| `When I send a GET request to '/path'` | GET request |
| `When I send a POST request to '/path' with body:` | POST with DataTable body |
| `When I send a PUT request to '/path' with body:` | PUT with DataTable body |
| `When I send a DELETE request to '/path'` | DELETE request |
| `Then the response status should be 200` | Assert HTTP status code |
| `Then the response body field 'path' should equal 'value'` | Assert field value |
| `Then the response body field 'path' should exist` | Assert field exists |
| `And I store the response body field 'path' as 'varName'` | Capture response data |

**API DataTable Format:**
```gherkin
When I send a POST request to '/posts' with body:
  | key    | value          |
  | title  | My Post        |
  | body   | Content here   |
  | userId | 1              |
```

---

## Step Keyword Rules

| Keyword | Use For |
|---------|---------|
| `Given` | ONLY the first step (navigation/setup) |
| `When` | Actions (click, enter, select, navigate) |
| `Then` | First assertion after an action |
| `And` | Continuation of previous keyword type |
| `But` | Rarely used — negative continuation |

**Rule:** Never use `Then` before any `When` in a scenario (except after `Given` for visibility checks).
