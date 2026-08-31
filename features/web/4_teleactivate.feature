@web @teleconnect_activate
Feature: 4_TeleConnect - Activate Broadband Connection After Installation
    As an Activation Technician
    I want to activate broadband connections
    So that customers get their service enabled after installation

    @smoke @e2e
    Scenario: Activate Broadband Connection After Installation
        Given I navigate to the application

        # ═══ Login to Activate Application ═══
        Then 'TeleActivate.BtnQuickLoginActivate' should be visible
        When I click 'TeleActivate.BtnQuickLoginActivate'
        And I click 'TeleActivate.BtnLoginSubmit'
        Then 'TeleActivate.ActivationHeading' should be visible

        # ═══ Verify Order Card is Visible (Dynamic) ═══
        Then order containing '$$OrderId' should be visible

        # ═══ Start Activation Process ═══
        When I click 'TeleActivate.BtnStartActivation' in order containing '$$OrderId'
        And I enter 'PORT-12345' into 'TeleActivate.InputPortNumber'
        And I enter 'OLT-GPON-SHELF1' into 'TeleActivate.InputOltDevice'
        And I click 'TeleActivate.BtnBeginActivation'

        # ═══ Complete Activation Verification ═══
        When I click 'TeleActivate.BtnActivate' in order containing '$$OrderId'
        And I click 'TeleActivate.CheckPortAssigned'
        And I click 'TeleActivate.CheckSignalVerified'
        And I click 'TeleActivate.CheckBandwidthConfigured'
        And I click 'TeleActivate.CheckPingTest'
        And I click 'TeleActivate.BtnActivateConnection'

        # ═══ Logout ═══
        And I click 'TeleActivate.BtnLogout'
