@web @teleconnect_web
Feature: TeleConnect - End to End Order Placement
  As a new customer
  I want to register and place a broadband connection order
  Covering negative validation and positive flow in a single scenario

  @smoke @e2e
  Scenario: Register new account and place broadband order with full validation
    Given I navigate to the application

    # ═══ REGISTRATION - Negative Case ═══
    When I click 'TeleConnect.SwitchToRegister'
    And I click 'TeleConnect.RegisterSubmit'
    Then 'TeleConnect.RegisterName' should be visible

    # ═══ REGISTRATION - Positive Flow ═══
    When I enter '##FullName' into 'TeleConnect.RegisterName'
    And I enter '##Email' into 'TeleConnect.LoginEmail'
    And I enter '##Password' into 'TeleConnect.LoginPassword'
    And I click 'TeleConnect.RegisterSubmit'
    Then the url should contain 'customer'
    And 'TeleConnect.WelcomeHeading' should be visible

    # ═══ DASHBOARD VERIFICATION ═══
    Then 'TeleConnect.StatTotalOrders' should be visible
    And 'TeleConnect.StatInProgress' should be visible
    And 'TeleConnect.StatActivated' should be visible

    # ═══ NAVIGATE TO NEW ORDER ═══
    
    When I execute script to change button text
    And I click 'TeleConnect.BtnNewConnection'
    Then the url should contain 'order'
    And 'TeleConnect.StepBadge' should contain text 'Step 1'

    # ═══ STEP 1 - Negative Validation (Empty Submit) ═══
    When I click 'TeleConnect.BtnNext'
    Then 'TeleConnect.ErrorCustomerName' should have text 'Full name is required'
    And 'TeleConnect.ErrorCustomerEmail' should have text 'Email is required'
    And 'TeleConnect.ErrorCustomerPhone' should have text 'Phone number is required'
    And 'TeleConnect.ErrorCustomerAddress' should have text 'Address is required'
    And 'TeleConnect.ErrorIdType' should have text 'Please select an ID type'
    And 'TeleConnect.ErrorIdNumber' should have text 'ID number is required'

    # ═══ STEP 1 - Fill Customer Info ═══
    When I enter '##FullName' into 'TeleConnect.InputName'
    And I enter '##Email' into 'TeleConnect.InputEmail'
    And I enter '1990-05-15' into 'TeleConnect.InputDOB'
    And I select 'Male' from 'TeleConnect.SelectGender'
    And I enter '##MobileNum' into 'TeleConnect.InputPhone'
    And I enter '##PhoneNum' into 'TeleConnect.InputAltPhone'
    And I enter '##Address' into 'TeleConnect.InputAddress'
    And I select 'Aadhaar' from 'TeleConnect.SelectIdType'
    And I enter '123456789012' into 'TeleConnect.InputIdNumber'
    And I click 'TeleConnect.BtnNext'

    # ═══ STEP 2 - Location ═══
    Then 'TeleConnect.StepBadge' should contain text 'Step 2'
    When I select 'Delhi' from 'TeleConnect.SelectState'
    And I select 'Delhi' from 'TeleConnect.SelectCity'
    And I select 'Saket' from 'TeleConnect.SelectArea'
    And I enter '##Address' into 'TeleConnect.InputInstallAddress'
    And I click 'TeleConnect.BtnNext'

    # ═══ STEP 3 - Plan Selection ═══
    Then 'TeleConnect.StepBadge' should contain text 'Step 3'
    When I click 'TeleConnect.PlanWiFiEntertainment'
    And I click 'TeleConnect.BtnNext'

    # ═══ STEP 4 - Offers ═══
    Then 'TeleConnect.StepBadge' should contain text 'Step 4'
    And 'TeleConnect.PriceSummary' should be visible
    When I click 'TeleConnect.OfferNone'
    And I click 'TeleConnect.BtnNext'

    # ═══ STEP 5 - Schedule Installation ═══
    Then 'TeleConnect.StepBadge' should contain text 'Step 5'
    When I enter '2026-06-15' into 'TeleConnect.InputPreferredDate'
    And I click 'TeleConnect.SlotAfternoon'
    And I enter 'Ring doorbell twice' into 'TeleConnect.InputSpecialInstructions'
    And I click 'TeleConnect.BtnNext'

    # ═══ STEP 6 - Confirm & Submit Order ═══
    Then 'TeleConnect.StepBadge' should contain text 'Step 6'
    When I click 'TeleConnect.BtnSubmitOrder'

    # ═══ ORDER SUCCESS ═══
    Then 'TeleConnect.OrderSuccess' should be visible
    And 'TeleConnect.OrderNumber' should be visible
    And 'TeleConnect.ExpectedDate' should be visible
    And I get text from 'TeleConnect.OrderNumber' and store as 'OrderId'
