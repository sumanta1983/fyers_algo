# Import the required module from the fyers_apiv3 package
import webbrowser

from fyers_apiv3 import fyersModel

# Replace these values with your actual API credentials
client_id = "8OBHJ855P4-100"  # Replace with your client ID
secret_key = "M1CG3K4ZH0"  # Replace with your secret key
redirect_uri = "https://trade.fyers.in/api-login/redirect-uri/index.html"
response_type = "code"  
state = "sample_state"
grant_type = "authorization_code"  

# Create a session model with the provided credentials
session = fyersModel.SessionModel(
    client_id=client_id,
    secret_key=secret_key,
    redirect_uri=redirect_uri,
    response_type=response_type,
    grant_type = grant_type  
)

# Generate the auth code using the session model
response_url = session.generate_authcode()


webbrowser.open(response_url)  # Open the auth code URL in the default web browser

# Print the auth code received in the response
# print(response)

auth_code = input("Enter auth code: ")  # Prompt the user to enter the auth code
session.set_token(auth_code)  # Set the token in the session model using the auth code
response = session.generate_token()  # Generate the access token using the session model

# print the response received after generating the token
# {
#   's': 'ok',
#   'code': 200,
#   'message': '',
#   'access_token': 'eyJ0eXAiOi***.eyJpc3MiOiJh***.HrSubihiFKXOpUOj_7***',
#   'refresh_token': 'eyJ0eXAiO***.eyJpc3MiOiJh***.67mXADDLrrleuEH_EE***'
# }

try:
    access_token = response["access_token"]
    # refresh_token = response["refresh_token"]
    print("Access Token:", access_token)
    # print("Refresh Token:", refresh_token)
    with open("token/fyers_access_token.txt", "w") as file:
        file.write(access_token)
    # with open("token/fyers_refresh_token.txt", "w") as file:
    #     file.write(refresh_token)
    with open("token/fyers_client_id.txt", "w") as file:
        file.write(client_id)
except Exception as e:
    print("Error generating access token:", str(e))
    print("Full response:", response)
    raise SystemExit(1)

#fyers = fyersModel.FyersModel(client_id=client_id, token=access_token, is_async=False, log_path="log")  # Create an instance of the FyersModel using the access token





# ----------------------------------------------------------------------------------
# SAMPLE SUCCESS RESPONSE : 
# ----------------------------------------------------------------------------------

# https://api-t1.fyers.in/api/v3/generate-authcode?
# client_id=SPXXXXE7-100&
# redirect_uri=https%3A%2F%2Fdev.fyers.in%2Fredirection%2Findex.html
# &response_type=code&state=sample_state&nonce=sample_nonce

# https://api-t1.fyers.in/api/v3/generate-authcode?
# client_id=C1WXTMYXEZ-200&
# redirect_uri=https%3A%2F%2Ftrade.fyers.in%2Fapi-login%2Fredirect-uri%2Findex.html&response_type=code&state=None
