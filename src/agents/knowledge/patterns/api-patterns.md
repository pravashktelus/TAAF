# API Testing Patterns Bank

Complete reference for generating REST API BDD scenarios. Use ONLY these exact step patterns.

---

## Available API Step Patterns (use EXACTLY as shown)

### Request Configuration
```gherkin
Given I set the base url to 'https://api.example.com'
Given I set the base url to '{api.baseUrl}'
Given I set bearer token '{authToken}'
Given I set api key 'mykey' in header 'x-api-key'
Given I clear the auth
```

### Requests WITHOUT Body (GET, DELETE, HEAD)
```gherkin
When I send a GET request to '/api/users/2'
When I send a DELETE request to '/api/users/2'
When I send a HEAD request to '/api/status'
```

### GET with Query Parameters (REQUIRES a data table below it)
```gherkin
When I send a GET request to '/api/users' with query params:
  | page  | 2  |
  | limit | 10 |
```
NOTE: Only use "with query params:" if you ALSO provide the table. Otherwise use plain GET.

### Requests WITH Body (POST, PUT, PATCH) — REQUIRES a data table
```gherkin
When I send a POST request to '/api/users' with body:
  | key      | value     |
  | name     | John      |
  | email    | j@test.com|

When I send a PUT request to '/api/users/1' with body:
  | key   | value    |
  | name  | Updated  |

When I send a PATCH request to '/api/users/1' with body:
  | key   | value  |
  | job   | Manager|
```

### Requests WITH inline JSON (alternative to table)
```gherkin
When I send a POST request to '/api/users' with JSON:
  """
  { "name": "John", "job": "Dev" }
  """
```

### Status Assertions
```gherkin
Then the response status should be 200
Then the response status should be in range 200 to 299
```

### Header Assertions
```gherkin
Then the response header 'Content-Type' should contain 'application/json'
Then the response should have header 'Authorization'
```

### Body Field Assertions
```gherkin
Then the response body field 'data.first_name' should equal 'Janet'
Then the response body field 'data.email' should contain '@'
Then the response body field 'id' should exist
Then the response body field 'token' should not be empty
Then the response body field 'data' should have 6 items
Then the response body field 'plans' should be a non-empty array
```

### Response Time
```gherkin
Then the response time should be less than 2000ms
```

### Capture / Chain
```gherkin
And I store the response body field 'token' as 'authToken'
And I store the response status as 'lastStatus'
Then I set bearer token '{authToken}'
```

### Debug
```gherkin
Then I print the response
```

---

## Field Path Syntax (for body assertions)
- `id` — top-level field
- `user.name` — nested object
- `user.address.city` — deeply nested
- `0.id` — first array element's id
- `plans.0.title` — first plan's title in a plans array
- `data.0.email` — first item's email in a data array

---

## Golden Example (follow this structure exactly)

```gherkin
@api @teleconnect @order-journey-api
Feature: TeleConnect API - Order Lifecycle
  As a telecom system
  I want to validate each API endpoint independently

  Background:
    Given I set the base url to '{api.baseUrl}'

  @smoke @auth
  Scenario: Register new customer
    When I send a POST request to '/api/auth/register' with body:
      | key      | value                    |
      | name     | API Journey User         |
      | email    | api.test@testuser.com    |
      | password | Test@12345               |
      | phone    | 9876543210               |
    Then the response status should be in range 200 to 409

  @smoke @auth
  Scenario: Customer login and capture token
    When I send a POST request to '/api/auth/login' with body:
      | key      | value                 |
      | email    | api.test@testuser.com |
      | password | Test@12345            |
    Then the response status should be 200
    And the response body field 'user' should exist
    And I store the response body field 'token' as 'authToken'
    And I set bearer token '{authToken}'

  @smoke @orders
  Scenario: Get available plans
    When I send a GET request to '/api/plans'
    Then the response status should be 200
    And the response body field 'plans' should be a non-empty array

  @negative @auth
  Scenario: Login with wrong password
    When I send a POST request to '/api/auth/login' with body:
      | key      | value           |
      | email    | crm@telecom.com |
      | password | wrongpassword   |
    Then the response status should be 401

  @negative @auth
  Scenario: Unauthenticated access to orders
    When I send a GET request to '/api/orders'
    Then the response status should be 401
```

---

## Rules for API Test Generation

1. **Base URL in Background** — set once, don't repeat in scenarios
2. **POST/PUT/PATCH ALWAYS need a body table** — never leave `with body:` without a table
3. **GET/DELETE never take a body** — just the endpoint
4. **Only use `with query params:` WITH a table** — otherwise plain GET
5. **Body table format** — first row is always `| key | value |`, then data rows
6. **Chain auth** — login → store token → set bearer token → use in next requests
7. **Negative cases** — assert ONLY on status codes (401, 404, 400, 409). Don't invent response body error messages unless the API documents them.
8. **Status ranges** — use "in range X to Y" for endpoints that may return varying success codes (e.g., 200-409 for register-or-exists)
9. **Field paths** — use dot notation and array indices (`data.0.id`, `plans.0.title`)
10. **Store before chaining** — capture IDs/tokens with "store the response body field" before using them in later requests

---

## Common Status Codes
| Code | Meaning | When to assert |
|------|---------|----------------|
| 200 | OK | Successful GET/PUT/DELETE |
| 201 | Created | Successful POST |
| 400 | Bad Request | Invalid/missing body fields |
| 401 | Unauthorized | Missing/invalid auth |
| 403 | Forbidden | Valid auth, no permission |
| 404 | Not Found | Non-existent resource |
| 409 | Conflict | Duplicate resource |
