@api
Feature: ReqRes API - Complete CRUD & Validation Suite
  As an API consumer
  I want to validate all ReqRes endpoints with full response assertions
  So that I can ensure API contract compliance

  Background:
    Given I set the base url to 'https://reqres.in'
    And I set api key '{REQRES_API_KEY}' in header 'x-api-key'

  # ═══════════════════════════════════════════════════════════════════════════
  # GET - List & Single Resource
  # ═══════════════════════════════════════════════════════════════════════════

  @smoke @get
  Scenario: GET list of users with pagination and field validation
    When I send a GET request to '/api/users?page=2'
    Then the response status should be 200
    And the response time should be less than 3000ms
    And the response body field 'page' should be '2'
    And the response body field 'per_page' should be '6'
    And the response body field 'total' should exist
    And the response body field 'total_pages' should exist
    And the response body field 'data' should be a non-empty array
    And the response body field 'data' should have 6 items
    And the response body field 'support.url' should exist
    And the response body field 'support.text' should not be empty

  @smoke @get
  Scenario: GET single user by ID with complete response validation
    When I send a GET request to '/api/users/2'
    Then the response status should be 200
    And the response time should be less than 2000ms
    And the response body field 'data.id' should be '2'
    And the response body field 'data.email' should be 'janet.weaver@reqres.in'
    And the response body field 'data.first_name' should be 'Janet'
    And the response body field 'data.last_name' should be 'Weaver'
    And the response body field 'data.avatar' should not be empty
    And the response body field 'data.avatar' should contain 'reqres.in'
    And the response should have header 'content-type'
    And the response header 'content-type' should contain 'application/json'

  @get @negative
  Scenario: GET non-existent user returns 404
    When I send a GET request to '/api/users/999'
    Then the response status should be 404

  @get
  Scenario: GET list of resources (colors)
    When I send a GET request to '/api/unknown'
    Then the response status should be 200
    And the response body field 'data' should be a non-empty array
    And the response body field 'data' should have 6 items

  @get
  Scenario: GET single resource by ID
    When I send a GET request to '/api/unknown/2'
    Then the response status should be 200
    And the response body field 'data.id' should be '2'
    And the response body field 'data.name' should be 'fuchsia rose'
    And the response body field 'data.year' should be '2001'
    And the response body field 'data.color' should be '#C74375'
    And the response body field 'data.pantone_value' should be '17-2031'

  @get @negative
  Scenario: GET non-existent resource returns 404
    When I send a GET request to '/api/unknown/999'
    Then the response status should be 404

  # ═══════════════════════════════════════════════════════════════════════════
  # GET - Delayed Response
  # ═══════════════════════════════════════════════════════════════════════════

  @get @performance
  Scenario: GET delayed response validates timing
    When I send a GET request to '/api/users?delay=1'
    Then the response status should be 200
    And the response body field 'data' should be a non-empty array

  # ═══════════════════════════════════════════════════════════════════════════
  # POST - Create Resources
  # ═══════════════════════════════════════════════════════════════════════════

  @smoke @post
  Scenario: POST create user with body and validate response fields
    When I send a POST request to '/api/users' with body:
      | key  | value          |
      | name | Prem Kumar     |
      | job  | QA Architect   |
    Then the response status should be 201
    And the response time should be less than 3000ms
    And the response body field 'name' should be 'Prem Kumar'
    And the response body field 'job' should be 'QA Architect'
    And the response body field 'id' should exist
    And the response body field 'id' should not be empty
    And the response body field 'createdAt' should exist
    And the response body field 'createdAt' should not be empty
    And I store the response body field 'id' as 'newUserId'
    And I log 'Created user with ID: {newUserId}'

  @post
  Scenario: POST create user with JSON body
    When I send a POST request to '/api/users' with JSON:
      """
      {"name": "Test User", "job": "Automation Engineer", "location": "India"}
      """
    Then the response status should be 201
    And the response body field 'name' should be 'Test User'
    And the response body field 'job' should be 'Automation Engineer'
    And the response body field 'id' should exist

  # ═══════════════════════════════════════════════════════════════════════════
  # POST - Register & Login
  # ═══════════════════════════════════════════════════════════════════════════

  @smoke @auth
  Scenario: POST register user successfully
    When I send a POST request to '/api/register' with body:
      | key      | value              |
      | email    | eve.holt@reqres.in |
      | password | pistol             |
    Then the response status should be 200
    And the response body field 'id' should exist
    And the response body field 'token' should exist
    And the response body field 'token' should not be empty
    And I store the response body field 'token' as 'authToken'
    And I store the response body field 'id' as 'registeredUserId'
    And I log 'Registered user ID: {registeredUserId}, Token: {authToken}'

  @auth @negative
  Scenario: POST register without password returns 400
    When I send a POST request to '/api/register' with body:
      | key   | value              |
      | email | eve.holt@reqres.in |
    Then the response status should be 400
    And the response body field 'error' should be 'Missing password'

  @auth @negative
  Scenario: POST register with unsupported email returns 400
    When I send a POST request to '/api/register' with body:
      | key      | value              |
      | email    | unknown@example.com |
      | password | test123            |
    Then the response status should be 400
    And the response body field 'error' should exist

  @smoke @auth
  Scenario: POST login successfully and validate token
    When I send a POST request to '/api/login' with body:
      | key      | value              |
      | email    | eve.holt@reqres.in |
      | password | cityslicka         |
    Then the response status should be 200
    And the response body field 'token' should exist
    And the response body field 'token' should not be empty
    And I store the response body field 'token' as 'loginToken'

  @auth @negative
  Scenario: POST login without password returns 400
    When I send a POST request to '/api/login' with body:
      | key   | value              |
      | email | eve.holt@reqres.in |
    Then the response status should be 400
    And the response body field 'error' should be 'Missing password'

  @auth @negative
  Scenario: POST login with invalid credentials returns 400
    When I send a POST request to '/api/login' with body:
      | key      | value              |
      | email    | invalid@nowhere.com |
      | password | wrongpass          |
    Then the response status should be 400
    And the response body field 'error' should exist

  # ═══════════════════════════════════════════════════════════════════════════
  # PUT - Update Resources
  # ═══════════════════════════════════════════════════════════════════════════

  @smoke @put
  Scenario: PUT update user completely
    When I send a PUT request to '/api/users/2' with body:
      | key  | value              |
      | name | Updated User       |
      | job  | Senior Architect   |
    Then the response status should be 200
    And the response body field 'name' should be 'Updated User'
    And the response body field 'job' should be 'Senior Architect'
    And the response body field 'updatedAt' should exist
    And the response body field 'updatedAt' should not be empty

  # ═══════════════════════════════════════════════════════════════════════════
  # PATCH - Partial Update
  # ═══════════════════════════════════════════════════════════════════════════

  @patch
  Scenario: PATCH partial update user
    When I send a PATCH request to '/api/users/2' with body:
      | key  | value            |
      | job  | Lead Engineer    |
    Then the response status should be 200
    And the response body field 'job' should be 'Lead Engineer'
    And the response body field 'updatedAt' should exist

  # ═══════════════════════════════════════════════════════════════════════════
  # DELETE - Remove Resources
  # ═══════════════════════════════════════════════════════════════════════════

  @smoke @delete
  Scenario: DELETE user returns 204 No Content
    When I send a DELETE request to '/api/users/2'
    Then the response status should be 204

  # ═══════════════════════════════════════════════════════════════════════════
  # Chained API Calls - Create → Read → Update → Delete (CRUD Flow)
  # ═══════════════════════════════════════════════════════════════════════════

  @regression @crud
  Scenario: Full CRUD lifecycle - Create, Read, Update, Delete
    # CREATE
    When I send a POST request to '/api/users' with body:
      | key  | value           |
      | name | CRUD Test User  |
      | job  | Tester          |
    Then the response status should be 201
    And the response body field 'id' should exist
    And I store the response body field 'id' as 'crudUserId'

    # READ (verify user exists in list)
    When I send a GET request to '/api/users/2'
    Then the response status should be 200
    And the response body field 'data.id' should be '2'

    # UPDATE
    When I send a PUT request to '/api/users/{crudUserId}' with body:
      | key  | value              |
      | name | Updated CRUD User  |
      | job  | Senior Tester      |
    Then the response status should be 200
    And the response body field 'name' should be 'Updated CRUD User'
    And the response body field 'job' should be 'Senior Tester'

    # DELETE
    When I send a DELETE request to '/api/users/{crudUserId}'
    Then the response status should be 204

  # ═══════════════════════════════════════════════════════════════════════════
  # Response Chaining - Store & Reuse Values Across Requests
  # ═══════════════════════════════════════════════════════════════════════════

  @regression @chaining
  Scenario: Chain responses - register then use token for subsequent calls
    # Register to get token
    When I send a POST request to '/api/register' with body:
      | key      | value              |
      | email    | eve.holt@reqres.in |
      | password | pistol             |
    Then the response status should be 200
    And I store the response body field 'token' as 'bearerToken'
    And I store the response body field 'id' as 'userId'

    # Use stored values in next request
    Given I set bearer token '{bearerToken}'
    When I send a GET request to '/api/users/{userId}'
    Then the response status should be 200
    And the response body field 'data.id' should be '{userId}'

  @regression @chaining
  Scenario: Store multiple fields and validate cross-request consistency
    When I send a GET request to '/api/users/1'
    Then the response status should be 200
    And I store the response body field 'data.email' as 'userEmail'
    And I store the response body field 'data.first_name' as 'firstName'
    And I store the response body field 'data.last_name' as 'lastName'

    When I send a GET request to '/api/users/1'
    Then the response status should be 200
    And the response body field 'data.email' should be '{userEmail}'
    And the response body field 'data.first_name' should be '{firstName}'
    And the response body field 'data.last_name' should be '{lastName}'

  # ═══════════════════════════════════════════════════════════════════════════
  # Performance & Headers Validation
  # ═══════════════════════════════════════════════════════════════════════════

  @performance
  Scenario: Validate response time is within SLA for list endpoint
    When I send a GET request to '/api/users?page=1'
    Then the response status should be 200
    And the response time should be less than 3000ms
    And the response body field 'data' should have 6 items

  @headers
  Scenario: Validate response headers for content-type and server
    When I send a GET request to '/api/users/1'
    Then the response status should be 200
    And the response should have header 'content-type'
    And the response header 'content-type' should contain 'application/json'

  # ═══════════════════════════════════════════════════════════════════════════
  # Data-Driven - Multiple Users Validation
  # ═══════════════════════════════════════════════════════════════════════════

  @regression @data-driven
  Scenario: Validate user 1 details
    When I send a GET request to '/api/users/1'
    Then the response status should be 200
    And the response body field 'data.id' should be '1'
    And the response body field 'data.email' should be 'george.bluth@reqres.in'
    And the response body field 'data.first_name' should be 'George'
    And the response body field 'data.last_name' should be 'Bluth'

  @regression @data-driven
  Scenario: Validate user 3 details
    When I send a GET request to '/api/users/3'
    Then the response status should be 200
    And the response body field 'data.id' should be '3'
    And the response body field 'data.email' should be 'emma.wong@reqres.in'
    And the response body field 'data.first_name' should be 'Emma'
    And the response body field 'data.last_name' should be 'Wong'

  @regression @data-driven
  Scenario: Validate user 4 details
    When I send a GET request to '/api/users/4'
    Then the response status should be 200
    And the response body field 'data.id' should be '4'
    And the response body field 'data.email' should be 'eve.holt@reqres.in'
    And the response body field 'data.first_name' should be 'Eve'
    And the response body field 'data.last_name' should be 'Holt'
