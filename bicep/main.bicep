// Subscription-scope deployment for MSPC Attendance.
//
//   az deployment sub create \
//     --location eastasia \
//     --template-file bicep/main.bicep \
//     --parameters bicep/main.parameters.json
//
// Validate before deploying - `az bicep build --file bicep/main.bicep` catches a
// template error in a second, where a deployment takes two minutes to report the
// same thing and leaves half the resources behind.

targetScope = 'subscription'

@description('Short name used to build every resource name.')
param appName string = 'mspc'

@description('Environment suffix, e.g. prod.')
param environment string = 'prod'

@description('''
Region for the Static Web App. The Free plan exists in only five regions and
East Asia is the only one in Asia-Pacific, so this is effectively fixed.
''')
@allowed([
  'centralus'
  'eastus2'
  'westus2'
  'westeurope'
  'eastasia'
])
param appLocation string = 'eastasia'

@description('''
Region for Cosmos DB. Onshore in Auckland, deliberately NOT co-located with the
Function.

The data is health-inferable: no diagnosis is stored, but groupTypes.shortValue
is MS or PD, so a person's group membership implies their condition. That is
unavoidable in a system built to run attendance for condition-specific groups,
so the data is treated as health information and kept in New Zealand.

The cost is latency. Static Web Apps Free exists in only five regions, none
closer than East Asia, so the Function sits in Hong Kong and every Cosmos query
pays a ~140ms round trip to Auckland. Keep the number of queries per request
down - byIds and byFieldIn in repo.ts exist for that.

CANNOT be changed later without recreating the account.
''')
param cosmosLocation string = 'newzealandnorth'

@description('Custom domain to bind, e.g. app.mspc.org.nz. Leave empty on the first pass.')
param customDomain string = ''

@description('Comma-separated email domains permitted to hold an admin record.')
param adminEmailDomains string = 'mspc.org.nz'

@description('Cosmos DB read-write key, read from Key Vault by the deploy script.')
@secure()
param cosmosKey string = ''

@description('Object id of the principal that administers Key Vault (you).')
param keyVaultAdminObjectId string = ''

var prodResourceGroup = 'rg-${appName}-${environment}'
var dataResourceGroup = 'rg-${appName}-data'

resource rgProd 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: prodResourceGroup
  location: appLocation
}

resource rgData 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: dataResourceGroup
  location: cosmosLocation
}

module data 'data.bicep' = {
  name: 'data'
  scope: rgData
  params: {
    appName: appName
    location: cosmosLocation
    keyVaultAdminObjectId: keyVaultAdminObjectId
  }
}

module app 'app.bicep' = {
  name: 'app'
  scope: rgProd
  params: {
    appName: appName
    environment: environment
    location: appLocation
    customDomain: customDomain
    adminEmailDomains: adminEmailDomains
    cosmosEndpoint: data.outputs.cosmosEndpoint
    cosmosDatabase: data.outputs.cosmosDatabase
    cosmosKey: cosmosKey
  }
}

output staticWebAppName string = app.outputs.staticWebAppName
output defaultHostname string = app.outputs.defaultHostname
output cosmosAccountName string = data.outputs.cosmosAccountName
output keyVaultName string = data.outputs.keyVaultName
