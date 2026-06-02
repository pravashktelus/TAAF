@web @customersupport_web
Feature: 6_CustomerSupport - Create Support Ticket for Broadband Order
  As a registered customer with an existing order
  I want to raise a support ticket for a technical issue
  So that I can get help resolving my connectivity problem

  @smoke @e2e
  Scenario: Login and create a support ticket for an existing order
    Given I navigate to the application

    # ═══ LOGIN WITH REGISTERED USER ═══
    When I enter '$$Email' into 'CustomerSupport.SigninEmail'
    And I enter '$$Password' into 'CustomerSupport.SigninPassword'
    And I click 'CustomerSupport.BtnSignIn'
    Then the url should contain 'customer'

    # ═══ NAVIGATE TO ORDERS PAGE ═══
    When I click 'CustomerSupport.NavOrders'
    Then the url should contain 'orders'
    And 'CustomerSupport.OrdersHeading' should be visible

    # ═══ VIEW ORDER DETAILS & OPEN SUPPORT ═══
    When I click 'CustomerSupport.BtnViewDetails'
    Then 'CustomerSupport.SupportHeading' should be visible
    When I click 'CustomerSupport.BtnSupport'
    Then 'CustomerSupport.DialogHeading' should be visible

    # ═══ FILL SUPPORT TICKET FORM ═══
    When I select 'Technical Issue' from dropdown 'CustomerSupport.SelectIssueType'
    And I enter 'Internet connectivity problem' into 'CustomerSupport.InputIssueTitle'
    And I enter 'Intermittent connection drops since yesterday' into 'CustomerSupport.InputDescription'
    And I click 'CustomerSupport.BtnCreateTicket'

    # ═══ VERIFY SUCCESS MESSAGE ═══
    Then 'CustomerSupport.SuccessToast' should be visible

    # ═══ VERIFY TICKET STATUS AND COLOR ═══
    Then 'CustomerSupport.TicketStatus' should have text 'OPEN'
    And 'CustomerSupport.TicketStatus' should have color 'red'

    # ═══ EXPAND TICKET & CAPTURE TICKET ID FOR REPORT ═══
    When I click 'CustomerSupport.FirstTicketCard'
    Then 'CustomerSupport.TicketIdValue' should be visible
    And I get text from 'CustomerSupport.TicketIdValue' and store as 'TicketId'
    And I attach 'TicketId' to the report as 'Support Ticket ID'
