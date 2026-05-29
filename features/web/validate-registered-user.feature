@web @teleconnect_registered-user
Feature: TeleConnect - Validate Registered User on UI Application
    As a new customer
    I want to validate registered user are able to login to system

    @smoke @login
    Scenario: Registerd user should be able to login to system
        Given I navigate to the application

        # ═══ Login - registered user ═══

        When I enter 'Test.API@testuser.com' into 'Validate-registered-user.SigninEmail'
        And I click 'Validate-registered-user.SigninPassword'
        Then I enter '********' into 'Validate-registered-user.SigninPassword'
        And I click 'Validate-registered-user.SigninButton'


        # ═══ Home - validations at home page ═══
        And 'Validate-registered-user.HomepageWelcomeNote' should have text 'Test User'
        Then 'Validate-registered-user.HomepageLogout' should be visible