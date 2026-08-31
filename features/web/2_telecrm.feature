@web @teleconnect_crm
Feature: 2_TeleConnect - Orders flow down from order placement apps to CRM activities
    As a tester
    I want to execute and validate all downstream CRM activities within a single scenario.

    @smoke @e2e
    Scenario: CRM Activity Validations for Order Ingestion
        Given I navigate to the application

        # ═══ Login to CRM Application - Positive Flow ═══
        When 'TeleCRM.CRMButton' should be visible
        Then I click 'TeleCRM.CRMButton'
        And I click 'TeleCRM.LoginSubmit'
        And 'TeleCRM.CRMHomePage' should be visible

        # ═══ Verify Order is Visible (Dynamic - targets specific order) ═══
        Then order containing '$$OrderId' should be visible

        # ═══ Review Order Details - Positive Flow ═══
        When I click 'TeleCRM.CRMReview' in order containing '$$OrderId'
        And I enter 'Review Done!!' into 'TeleCRM.CRMReviewNotes'
        And I click 'TeleCRM.CRMReviewButton'
        And 'TeleCRM.CRMApproveButton' should be visible
        And I click 'TeleCRM.CRMApproveButton'

        Then I click 'TeleCRM.CRMPopupCustomerID'
        And I click 'TeleCRM.CRMPopupAddress'
        And I click 'TeleCRM.CRMPopupPlanElig'
        And I click 'TeleCRM.CRMPopupApproveOrder'

        And 'TeleCRM.CRMStatus' should be visible
        And I click 'TeleCRM.CRMLogout'
