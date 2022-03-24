#!/bin/bash
project_dir="$(pwd)/packages/website"

echo "INFO: Configuring UI"

#################################
# Configurable parameters end   #
#################################
echo "INFO: Fetching deployment information."
outputs_description=$(aws cloudformation list-exports --region $REGION --output json)

export identity_pool_id=$(echo $outputs_description | jq -r '.Exports[] | select(.Name == "${PROJECT_NAME}-IdentityPoolId") | .Value')
export user_pool_id=$(echo $outputs_description | jq -r '.Exports[] | select(.Name == "${PROJECT_NAME}-UserPoolId") | .Value')
export user_pool_app_client_id=$(echo $outputs_description | jq -r '.Exports[] | select(.Name == "${PROJECT_NAME}-UserPoolAppClientId") | .Value')
export user_pool_domain=$(echo $outputs_description | jq -r '.Exports[] | select(.Name == "${PROJECT_NAME}-UserPoolDomain") | .Value')
export analytics_app_id=$(echo $outputs_description | jq -r '.Exports[] | select(.Name == "${PROJECT_NAME}-AnalyticsAppId") | .Value')
export api_url=$(echo $outputs_description | jq -r '.Exports[] | select(.Name == "${PROJECT_NAME}-APIUrl") | .Value')

echo "INFO: Creating Typescript configuration"
config="const awsmobile = { \
  \n'aws_project_region': '${REGION}', \
  \n'aws_cognito_identity_pool_id': '${identity_pool_id}', \
  \n'aws_cognito_region': '${AWS_REGION}', \
  \n'aws_user_pools_id': '${user_pool_id}', \
  \n'aws_user_pools_web_client_id': '${user_pool_app_client_id}', \
  \n'aws_user_pool_domain': '${user_pool_domain}', \
  \n'aws_mobile_analytics_app_id': '${analytics_app_id}', \
  \n'aws_mobile_analytics_app_region': '${REGION}', \
  \n'api_url': '${api_url}', \
\n}; \
\nexport default awsmobile;"

echo "INFO: Writing Typescript configuration"
echo $config > $project_dir/src/config/aws-exports.ts
