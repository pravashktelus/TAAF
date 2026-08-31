# Feature File Examples Bank

Golden examples showing correct structure. Use as reference for any application.

---

## Example 1: Registration + Multi-Step Flow (Web)

```gherkin
@web @modulename_web
Feature: ModuleName - Source Description
  As a new user
  I want to register and complete a multi-step process

  @smoke @e2e
  Scenario: Register and complete full workflow
    Given I navigate to the application

    # ═══ REGISTRATION - Negative Validation ═══
    When I click 'Page.BtnRegister'
    And I click 'Page.BtnSubmit'
    Then 'Page.ErrorName' should have text 'Name is required'

    # ═══ REGISTRATION - Positive Flow ═══
    When I enter '##FullName' into 'Page.InputName'
    And I store attribute 'value' of 'Page.InputName' as 'FullName'
    And I enter '##Email' into 'Page.InputEmail'
    And I store attribute 'value' of 'Page.InputEmail' as 'Email'
    And I enter '##Password' into 'Page.InputPassword'
    And I store attribute 'value' of 'Page.InputPassword' as 'Password'
    And I persist '{FullName}' as 'FullName'
    And I persist '{Email}' as 'Email'
    And I persist '{Password}' as 'Password'
    And I click 'Page.BtnSubmit'
    Then the url should contain '/dashboard'
    And 'Page.WelcomeHeading' should be visible

    # ═══ STEP 1 - Form Fill ═══
    When I click 'Page.BtnStartProcess'
    Then 'Page.StepIndicator' should contain text 'Step 1'
    When I enter '##FullName' into 'Page.InputField1'
    And I select 'Option' from 'Page.SelectField2'
    And I enter '##MobileNum' into 'Page.InputPhone'
    And I click 'Page.BtnNext'

    # ═══ STEP 2 - Selection ═══
    Then 'Page.StepIndicator' should contain text 'Step 2'
    When I click 'Page.OptionCard'
    And I click 'Page.BtnNext'

    # ═══ SUBMIT & SUCCESS ═══
    When I click 'Page.BtnSubmitFinal'
    Then 'Page.SuccessSection' should be visible
    And 'Page.GeneratedId' should be visible
    And I get text from 'Page.GeneratedId' and store as 'RecordId'
    And I persist '{RecordId}' as 'RecordId'
```

---

## Example 2: Login + Downstream Action (Cross-Scenario)

```gherkin
@web @modulename_web
Feature: ModuleName - Process Dependent on Previous Scenario
  As an operator
  I want to act on a record created by a previous scenario

  @smoke @e2e
  Scenario: Login and process the record
    Given I navigate to the application

    # ═══ LOGIN ═══
    When I enter '$$Email' into 'Page.InputEmail'
    And I enter '$$Password' into 'Page.InputPassword'
    And I click 'Page.BtnLogin'
    Then the url should contain '/home'

    # ═══ FIND RECORD ═══
    When I click 'Page.NavRecords'
    Then 'Page.RecordList' should be visible

    # ═══ ACT ON RECORD ═══
    When I click 'Page.BtnAction'
    And I enter 'Notes here' into 'Page.InputNotes'
    And I click 'Page.BtnConfirm'
    Then 'Page.StatusLabel' should have text 'COMPLETED'
```

---

## Example 3: API CRUD with DataTable

```gherkin
@api @modulename
Feature: ModuleName - API Endpoints
  As a developer
  I want to validate API endpoints

  Background:
    Given I set the base url to 'https://api.example.com'

  @smoke @e2e
  Scenario: Create a resource
    When I send a POST request to '/resources' with body:
      | key   | value         |
      | name  | Test Resource |
      | type  | standard      |
    Then the response status should be 201
    And the response body field 'id' should exist
    And I store the response body field 'id' as 'resourceId'

  @smoke @e2e
  Scenario: Read the resource
    When I send a GET request to '/resources/1'
    Then the response status should be 200
    And the response body field 'name' should exist

  @negative @regression
  Scenario: Create with missing required field
    When I send a POST request to '/resources' with body:
      | key  | value |
      | type | standard |
    Then the response status should be 400
```

---

## Example 4: Negative Scenario (Standalone)

```gherkin
  @negative @regression
  Scenario: Login with invalid credentials
    Given I navigate to the application
    When I enter 'wrong@email.com' into 'Page.InputEmail'
    And I enter 'wrongpassword' into 'Page.InputPassword'
    And I click 'Page.BtnLogin'
    Then 'Page.ErrorMessage' should be visible
    And the url should contain '/login'
```

---

## Structure Rules

1. **Tags:** `@web @modulename_web` for web, `@api @modulename` for API
2. **Feature header:** Always include "As a [role], I want to [action]"
3. **Scenario naming:** `TC-001 Descriptive title of what's being tested`
4. **First step:** `Given I navigate to the application` (web) or Background base URL (API)
5. **Section comments:** `# ═══ SECTION NAME ═══` to group logical blocks
6. **Assertions after actions:** Every click/submit should be followed by a verification
7. **One scenario = one logical flow:** Don't mix unrelated actions in one scenario
