@web @teleconnect_registered-user
Feature: 2_TeleConnect - Validate Registered User on UI Application
    As a new customer
    I want to validate registered users are able to login to system

    @smoke @login
    Scenario: Registerd user should be able to login to system
        Given I navigate to the application

        # ═══ Login - registered user ═══

        #When I click 'Validate-registered-user.SwitchToLogin'
        When 'Validate-registered-user.SigninEmail' should be visible
        Then I enter '$$Email_viaAPI' into 'Validate-registered-user.SigninEmail'
        And I enter '$$Password_viaAPI' into 'Validate-registered-user.SigninPassword'
        And I click 'Validate-registered-user.SigninButton'


        # ═══ Home - validations at home page ═══
        And 'Validate-registered-user.HomepageWelcomeNote' should have text '$$FullName_viaAPI'
        Then 'Validate-registered-user.HomepageLogout' should be visible