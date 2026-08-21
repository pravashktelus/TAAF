# User Story: JSONPlaceholder API - CRUD Operations

## Title
As a developer, I want to verify CRUD operations on the JSONPlaceholder REST API so that I can confirm the endpoints work correctly.

## Application URL
https://jsonplaceholder.typicode.com

## Type
API

## Acceptance Criteria

### AC-1: Get All Posts
- Given I set the base url to 'https://jsonplaceholder.typicode.com'
- When I send a GET request to '/posts'
- Then the response status should be 200
- And the response body field '0.id' should exist
- And I store the response body field '0.id' as 'firstPostId'

### AC-2: Get Single Post by ID
- Given I set the base url to 'https://jsonplaceholder.typicode.com'
- When I send a GET request to '/posts/1'
- Then the response status should be 200
- And the response body field 'id' should equal '1'
- And the response body field 'title' should exist
- And the response body field 'userId' should exist

### AC-3: Create a New Post
- Given I set the base url to 'https://jsonplaceholder.typicode.com'
- When I send a POST request to '/posts' with body:
  - | key    | value                    |
  - | title  | Test Post from BDD Agent |
  - | body   | This is automated test   |
  - | userId | 1                        |
- Then the response status should be 201
- And the response body field 'id' should exist
- And the response body field 'title' should equal 'Test Post from BDD Agent'

### AC-4: Delete a Post
- Given I set the base url to 'https://jsonplaceholder.typicode.com'
- When I send a DELETE request to '/posts/1'
- Then the response status should be 200

## Test Data
- Base URL: https://jsonplaceholder.typicode.com
- Post Title: "Test Post from BDD Agent"
- Post Body: "This is automated test"
- User ID: 1

## Tags
@api @smoke @jsonplaceholder

## Notes
- JSONPlaceholder is a free fake REST API for testing
- POST/DELETE operations are faked (returns success but doesn't persist)
- No authentication required
