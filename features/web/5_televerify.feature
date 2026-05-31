@web @teleconnect_verify
Feature: 5_TeleConnect - Verify Broadband Order Activation Status
    As a customer
    I want to verify my broadband order status is Activated
    So that I know my service is live after activation

    @smoke @e2e
    Scenario: Verify broadband order status shows Activated on customer dashboard
        Given I navigate to 'https://simulapp.online/login'

        # ═══ Login ═══
        When I enter '$$Email' into 'TeleConnect.LoginEmail'
        And I enter '$$Password' into 'TeleConnect.LoginPassword'
        And I click 'TeleConnect.LoginSubmit'
        Then 'TeleVerify.DashboardHeading' should be visible

        # ═══ Dashboard Verification ═══
        Then 'TeleVerify.OrderList' should be visible
        And 'TeleVerify.OrderCard' should be visible
        And 'TeleVerify.OrderStatusBadge' should contain text 'ACTIVATED'

        # ═══ Logout ═══
        And I click 'TeleVerify.BtnLogout'
