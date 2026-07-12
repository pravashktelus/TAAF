# Test Cases

Drop your manually written test cases here.

## Supported Formats
- `.xlsx` / `.xls` — Excel test cases (most common in QA teams)
- `.md` — Markdown test cases
- `.txt` — Plain text test cases

## Expected XLS Structure
The Planner expects these column headers (configurable in framework.properties):

| TC ID  | Title           | Step No | Action/Navigation      | Test Data     | Expected Result     |
|--------|-----------------|---------|------------------------|---------------|---------------------|
| TC-001 | Create Order    | 1       | Navigate to login page | —             | Login page shown    |
|        |                 | 2       | Enter credentials      | user@test.com | Fields populated    |
|        |                 | 3       | Click Login            | —             | Dashboard shown     |
| TC-002 | Validate Form   | 1       | Leave fields empty     | —             | Errors displayed    |

**Note:** TC ID only needs to be in the first row of each test case.
Subsequent rows for the same test case can have an empty TC ID — the Planner groups them automatically.

## Usage
```bash
npm run agent:plan -- --testcases orders-testcases.xlsx --page Orders
npm run agent:plan -- --testcases orders-testcases.xlsx --url https://app.com/orders --page Orders
```

## Column Name Customization
If your XLS uses different column headers, update `framework.properties`:
```properties
agents.xls.col.tcId=Test Case ID
agents.xls.col.action=Test Steps
agents.xls.col.expected=Expected Outcome
```
