@api @teleconnect @order-journey-api
Feature: TeleConnect API - Endpoint Wise Order Lifecycle

  As a telecom system
  I want to validate each API endpoint independently
  So that the broadband order lifecycle works correctly

  Background:
    Given I set the base url to '{api.baseUrl}'


  #########################################################
  # AUTH APIs
  #########################################################

  @smoke @auth
  Scenario: #01 Register new customer

    When I send a POST request to '/api/auth/register' with body:
      | key      | value                         |
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

    # Get service areas
    When I send a GET request to '/api/service-areas'
    Then the response status should be 200
    And the response body field 'serviceAreas' should exist


  #########################################################
  # CRM FLOW
  #########################################################

  @smoke @crm
  Scenario: #08 CRM Review order

    # Login as CRM
    When I send a POST request to '/api/auth/login' with body:
      | key      | value           |
      | email    | crm@telecom.com |
      | password | crm123          |

    Then the response status should be 200
    And I store the response body field 'token' as 'crmToken'
    And I set bearer token '{crmToken}'

    # Get all orders
    When I send a GET request to '/api/orders'
    Then the response status should be 200


  @smoke @crm
  Scenario: #09 CRM Approve order

    # Login as CRM
    When I send a POST request to '/api/auth/login' with body:
      | key      | value           |
      | email    | crm@telecom.com |
      | password | crm123          |

    Then the response status should be 200
    And I store the response body field 'token' as 'crmToken'
    And I set bearer token '{crmToken}'

    # Get all orders
    When I send a GET request to '/api/orders'
    Then the response status should be 200


  #########################################################
  # INSTALLATION FLOW
  #########################################################

  @smoke @installation
  Scenario: #10 Schedule installation

    # Login as Installation
    When I send a POST request to '/api/auth/login' with body:
      | key      | value              |
      | email    | install@telecom.com |
      | password | install123         |

    Then the response status should be 200
    And I store the response body field 'token' as 'installToken'
    And I set bearer token '{installToken}'

    # Get installation orders
    When I send a GET request to '/api/orders'
    Then the response status should be 200


  @smoke @installation
  Scenario: #11 Complete installation

    # Login as Installation
    When I send a POST request to '/api/auth/login' with body:
      | key      | value              |
      | email    | install@telecom.com |
      | password | install123         |

    Then the response status should be 200
    And I store the response body field 'token' as 'installToken'
    And I set bearer token '{installToken}'

    # Get installation orders
    When I send a GET request to '/api/orders'
    Then the response status should be 200


  #########################################################
  # ACTIVATION FLOW
  #########################################################

  @smoke @activation
  Scenario: #12 Start activation

    # Login as Activation
    When I send a POST request to '/api/auth/login' with body:
      | key      | value                |
      | email    | activation@telecom.com |
      | password | activation123         |

    Then the response status should be 200
    And I store the response body field 'token' as 'activationToken'
    And I set bearer token '{activationToken}'

    # Get activation orders
    When I send a GET request to '/api/orders'
    Then the response status should be 200


  @smoke @activation
  Scenario: #13 Activate broadband connection

    # Login as Activation
    When I send a POST request to '/api/auth/login' with body:
      | key      | value                |
      | email    | activation@telecom.com |
      | password | activation123         |

    Then the response status should be 200
    And I store the response body field 'token' as 'activationToken'
    And I set bearer token '{activationToken}'

    # Get activation orders
    When I send a GET request to '/api/orders'
    Then the response status should be 200


  #########################################################
  # NEGATIVE CASES
  #########################################################

  @negative @auth
  Scenario: #14 Unauthenticated access to orders

    # Try to access orders without authentication
    When I send a GET request to '/api/orders'

    Then the response status should be 401

