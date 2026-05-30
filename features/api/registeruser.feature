@api @teleconnect @register-user-api
Feature: TeleConnect Register API - Sign-up process

  As a telecom user
  I want to register mydetails in a telecom application
 
  Background:
    Given I set the base url to '{api.baseUrl}'


  #########################################################
  # Register API
  #########################################################

  @smoke @register
  Scenario: #01 Register new customer

    When I send a POST request to '/api/auth/register' with body:
      | key      | value                  |
      | name     | Test1 User             |
      | email    | Test1.API@testuser.com |
      | password | ********               |
      | phone    | 9999200100             |

    Then the response status should be in range 200 to 409