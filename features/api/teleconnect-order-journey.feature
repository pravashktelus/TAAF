@api @teleconnect @order-journey-api
Feature: TeleConnect API - Endpoint Wise Order Lifecycle

  As a telecom system
  I want to validate each API endpoint independently
  So that the broadband order lifecycle works correctly

  Background:
    Given I set the base url to 'http://localhost:3000'


  #########################################################
  # AUTH APIs
  #########################################################

  @smoke @auth
  Scenario: #01 Register new customer

    When I send a POST request to '/api/auth/register' with body:
      | key      | value                          |
      | name     | API Journey User              |
      | email    | api.journey.test@testuser.com |
      | password | Test@12345                    |
      | phone    | 9876543210                    |

    Then the response status should be in range 200 to 409


  @smoke @auth
  Scenario: #02 Customer login

    When I send a POST request to '/api/auth/login' with body:
      | key      | value                          |
      | email    | api.journey.test@testuser.com |
      | password | Test@12345                    |

    Then the response status should be 200
    And the response body field 'user' should exist
    And the response body field 'user.id' should exist
    And I store the response body field 'token' as 'authToken'
    And I set bearer token '{authToken}'


  @negative @auth
  Scenario: #03 Login with wrong password

    When I send a POST request to '/api/auth/login' with body:
      | key      | value           |
      | email    | crm@telecom.com |
      | password | wrongpassword   |

    Then the response status should be 401


  @negative @auth
  Scenario: #04 Duplicate email registration

    When I send a POST request to '/api/auth/register' with body:
      | key      | value           |
      | name     | Duplicate User  |
      | email    | crm@telecom.com |
      | password | password123     |

    Then the response status should be in range 400 to 409


  #########################################################
  # MASTER APIs
  #########################################################

  @smoke @plans
  Scenario: #05 Get available plans

    When I send a GET request to '/api/plans'

    Then the response status should be 200
    And the response body field 'plans' should be a non-empty array


  @smoke @service-area
  Scenario: #06 Get service areas

    When I send a GET request to '/api/service-areas'

    Then the response status should be 200
    And the response body field 'serviceAreas' should exist


  #########################################################
  # ORDER CREATION
  #########################################################

  @smoke @orders
  Scenario: #07 Create new order

    # Login
    When I send a POST request to '/api/auth/login' with body:
      | key      | value                          |
      | email    | api.journey.test@testuser.com |
      | password | Test@12345                    |

    Then the response status should be 200
    And I store the response body field 'token' as 'authToken'
    And I set bearer token '{authToken}'

    # Get plan
    When I send a GET request to '/api/plans'
    Then the response status should be 200

    And I store the response body field 'plans.0.id' as 'planId'

    # Create order
    When I send a POST request to '/api/orders' with body:
      | key             | value                          |
      | customerName    | API Journey User              |
      | customerEmail   | api.journey.test@testuser.com |
      | customerPhone   | 9876543210                    |
      | customerAddress | B-42 Saket New Delhi          |
      | serviceAreaId   | cmpk248aj000dpewuacd9yryn     |
      | installAddress  | B-42 Saket New Delhi 110017   |
      | planId          | {planId}                      |

    Then the response status should be 201
    And the response body field 'order.id' should exist
    And the response body field 'order.status' should be 'SUBMITTED'

    And I store the response body field 'order.id' as 'orderId'
    And I log 'Order Created: {orderId}'

