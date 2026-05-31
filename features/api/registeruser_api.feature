@api @teleconnect @register-user-api
Feature: 1_TeleConnect Register API - Sign-up process

  As a telecom user
  I want to register mydetails in a telecom application

  Background:
    Given I set the base url to '{api.baseUrl}'


  #########################################################
  # Register API
  #########################################################

  @smoke @register
  Scenario: #01 Register new customer using API

    When I send a POST request to '/api/auth/register' with body:
      | key      | value                  |
      | name     | Test2 User             |
      | email    | Test2.API@testuser.com |
      | password | ********               |
      | phone    | 9999200100             |

    And I persist 'Test2 User' as 'FullName_viaAPI'
    And I persist 'Test2.API@testuser.com' as 'Email_viaAPI'
    And I persist '********' as 'Password_viaAPI'
    Then the response status should be in range 200 to 409