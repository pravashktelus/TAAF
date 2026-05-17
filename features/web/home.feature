@web @smoke
Feature: Sauce Demo - Complete Shopping Flow
  As a customer
  I want to browse products, add them to cart and checkout
  So that I can purchase items successfully

  Background:
    Given I navigate to 'https://www.saucedemo.com'


  @checkout @regression
  Scenario: Complete end-to-end checkout flow
    # Step 1: Login
    When I enter 'standard_user' into 'Login.UsernameField'
    And I enter 'secret_sauce' into 'Login.PasswordField'
    And I click 'Login.LoginButton'

    # Step 2: Add product to cart
    And I store text of 'Home.ProductName' as 'productName'
    And I store text of 'Home.ProductPrice' as 'productPrice'
    And I click 'Home.AddToCartButton'

    # Step 3: Navigate to cart
    And I click 'Home.CartIcon'
    Then the url should contain 'cart'
    And 'Cart.CartItemName' should be visible
    And 'Cart.CartItemName' should have text '{productName}'

    # Step 4: Proceed to checkout
    When I click 'Cart.CheckoutButton'
    And I enter 'John' into 'Checkout.FirstNameField'
    And I enter 'Doe' into 'Checkout.LastNameField'
    And I enter '12345' into 'Checkout.PostalCodeField'
    And I click 'Checkout.ContinueButton'

    # Step 5: Verify order summary and finish
    Then 'Checkout.SummaryTotal' should be visible
    When I click 'Checkout.FinishButton'
    Then 'Checkout.ConfirmationHeader' should be visible
