# Anti-Patterns & Rules

Critical rules for generating correct test scripts. Apply to ANY application.

---

## Don'ts (Will Cause Test Failures)

### 1. DON'T use `from dropdown` for native select elements
```
WRONG:  When I select 'Male' from dropdown 'Page.SelectGender'
RIGHT:  When I select 'Male' from 'Page.SelectGender'
```
`from dropdown` is ONLY for custom combobox components. Native `<select>` uses `from`.

### 2. DON'T hardcode unique data — use ## tokens
```
WRONG:  When I enter 'john@email.com' into 'Page.InputEmail'
RIGHT:  When I enter '##Email' into 'Page.InputEmail'
```
Hardcoded data causes conflicts on repeated runs. Use ## for anything that must be unique.

### 3. DON'T skip store + persist after ##random data
```
WRONG:
  When I enter '##Email' into 'Page.InputEmail'
  And I click 'Page.BtnSubmit'

RIGHT:
  When I enter '##Email' into 'Page.InputEmail'
  And I store attribute 'value' of 'Page.InputEmail' as 'Email'
  And I persist '{Email}' as 'Email'
  And I click 'Page.BtnSubmit'
```
If ##random data is needed by later scenarios, ALWAYS capture and persist it.

### 4. DON'T use `should have text` for partial matches
```
WRONG:  Then 'Page.Badge' should have text 'Step 1'     (element shows "Step 1 of 6")
RIGHT:  Then 'Page.Badge' should contain text 'Step 1'
```
Use `have text` only for EXACT matches. Use `contain text` when element has extra content.

### 5. DON'T invent steps that don't exist
```
WRONG:  When I wait for the url to contain '/page'
WRONG:  When I wait for 'Page.Element' to be visible
WRONG:  Then 'Page.Element' should not be visible
WRONG:  When I clear 'Page.InputField'
WRONG:  Then I should see 'text'
WRONG:  When I wait for 2 seconds
```
Use ONLY steps from the step-definitions-reference. If a step doesn't exist, don't use it.

### 6. DON'T use $$variables in negative tests
```
WRONG:  When I enter '$$password' into 'Page.InputPassword'   (in negative test)
RIGHT:  When I enter 'wrongpassword123' into 'Page.InputPassword'
```
Negative tests use INTENTIONALLY WRONG literal values. $$variables are real credentials.

### 7. DON'T skip initial navigation
Every web scenario MUST start with:
```gherkin
Given I navigate to the application
```
Each scenario runs in a fresh browser. There's no state from previous scenarios.

### 8. DON'T reuse element refs for wrong actions
```
WRONG:  When I select 'Option' from 'Page.InputEmail'   (InputEmail is a text input!)
RIGHT:  When I select 'Option' from 'Page.SelectCountry'  (SelectCountry is a dropdown)
```
Check the element key PREFIX — Input = text entry, Select = dropdown, Btn = click.

### 9. DON'T add inline comments to steps
```
WRONG:  When I click 'Page.BtnSubmit'  # Submit the form
RIGHT:  # ═══ Submit the form ═══
        When I click 'Page.BtnSubmit'
```
Inline comments break Cucumber regex matching. Use section headers ABOVE steps.

### 10. DON'T repeat the same element for unrelated fields
```
WRONG:
  When I enter '##FullName' into 'Page.InputEmail'    (name into email field!)
  When I enter '##Email' into 'Page.InputEmail'       (same field twice!)
```
Each field has its own element. Match data to the correct field element.

---

## Do's (Required for Quality)

### 1. DO organize with section comments
```gherkin
# ═══ LOGIN ═══
When I enter '$$Email' into 'Page.InputEmail'
...
# ═══ VERIFY DASHBOARD ═══
Then 'Page.Dashboard' should be visible
```

### 2. DO verify URL after navigation clicks
```gherkin
When I click 'Page.NavOrders'
Then the url should contain '/orders'
```

### 3. DO verify element visibility after page loads
```gherkin
Then the url should contain '/dashboard'
And 'Page.WelcomeHeading' should be visible
```

### 4. DO use `And` for continuation (not repeating When/Then)
```gherkin
When I enter 'value1' into 'Page.Field1'
And I enter 'value2' into 'Page.Field2'
And I click 'Page.BtnSubmit'
```

### 5. DO test negative BEFORE positive in combined scenarios
```gherkin
# Empty submit first
When I click 'Page.BtnSubmit'
Then 'Page.ErrorName' should have text 'Name is required'

# Then fill correctly
When I enter '##FullName' into 'Page.InputName'
And I click 'Page.BtnSubmit'
Then 'Page.Success' should be visible
```

### 6. DO persist data for downstream scenarios
```gherkin
And I get text from 'Page.OrderId' and store as 'OrderId'
And I persist '{OrderId}' as 'OrderId'
```

### 7. DO end negative scenarios with clear assertion
```gherkin
Then the url should contain '/login'
# OR
Then 'Page.ErrorMessage' should have text 'Invalid credentials'
```

---

## Story-to-Steps Translation

| Story says... | Generate... |
|--------------|-------------|
| "Register / Create account" | Enter ##FullName + ##Email + ##Password + store + persist + submit |
| "Login / Sign in" | Enter $$Email + $$Password + click login + verify dashboard |
| "Fill the form" | Enter into EVERY required field (match ## tokens to field types) |
| "Verify success" | `should be visible` on success element + `url should contain` |
| "Submit" | `I click 'Page.BtnSubmit'` |
| "Select from dropdown" | `I select 'Value' from 'Page.SelectElement'` |
| "Navigate to X" | `I click 'Page.NavX'` + `url should contain '/x'` |
| "Verify error" | `'Page.ErrorField' should have text 'Error message'` |
| "Capture/Store ID" | `get text from` + `persist` |
| "Check/Enable option" | `I check 'Page.CheckboxOption'` |
| "Search for X" | `I enter 'X' into 'Page.InputSearch'` + click search + verify results |
| "Add to cart" | Click add button + verify confirmation (modal/toast/count) |
| "Logout" | `I click 'Page.NavLogout'` + `url should contain '/login'` |

---

## Assertion Strength Decision Table

Choosing the RIGHT assertion is critical — wrong choice causes false failures or weak tests.

| Situation | Use This Assertion | Why |
|-----------|-------------------|-----|
| Element shows EXACT known text (error messages, labels, status) | `should have text 'exact value'` | Strict match — catches any deviation |
| Element has MORE text than what you check (badges like "Step 1 of 6", "Cart (3)") | `should contain text 'Step 1'` | Substring match — tolerates extra content |
| You only need to confirm an element appeared (success sections, modals, headings) | `should be visible` | Existence check — no text dependency |
| Confirming an element disappeared (dismissed modal, hidden field) | `should be hidden` | Inverse existence |
| Checking a form input's current value | `should have value 'x'` | Reads the value attribute |
| Verifying a button is clickable | `should be enabled` | State check |
| Verifying a button is NOT clickable | `should be disabled` | State check |
| After navigation/redirect | `the url should contain '/fragment'` | Verifies page transition |

### Decision Rules
1. **Error messages** → ALWAYS `should have text` (exact) — validation messages are fixed strings
2. **Step indicators / counters / badges** → ALWAYS `should contain text` — they have surrounding content
3. **Success confirmations (page/section appeared)** → `should be visible` — don't assume exact text
4. **Dynamic values (order IDs, timestamps)** → `should be visible` or `should contain text` — never `should have text` (values change each run)
5. **After a click that navigates** → ALWAYS add `the url should contain` as the primary assertion
6. **Post-login / post-submit** → verify BOTH url change AND a key element visible

### Examples

```gherkin
# Error message — EXACT text
Then 'Page.ErrorEmail' should have text 'Email is required'

# Step badge — has extra content ("Step 1 of 6")
Then 'Page.StepBadge' should contain text 'Step 1'

# Success section appeared — just check visibility
Then 'Page.OrderSuccess' should be visible

# Dynamic order number — don't assert exact text
Then 'Page.OrderNumber' should be visible

# After navigation — verify URL first
When I click 'Page.BtnSubmit'
Then the url should contain '/confirmation'
And 'Page.ConfirmHeading' should be visible
```
