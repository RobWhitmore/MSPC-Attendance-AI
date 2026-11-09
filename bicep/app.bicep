// Static Web App (Free), Application Insights, and the app settings the
// managed Function reads at runtime.

param appName string
param environment string
param location string
param customDomain string = ''
param adminEmailDomains string
param cosmosEndpoint string
param cosmosDatabase string

@secure()
param cosmosKey string

var staticWebAppName = 'stapp-${appName}-${environment}'

/*
  Register Microsoft.OperationalInsights before the first deployment. Application
  Insights needs a workspace, a subscription that has never used one has the
  provider unregistered, and the deployment then fails halfway through - after
  creating most of the other resources.
*/
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${appName}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${appName}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2024-04-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // The GitHub Action deploys; nothing here builds from source.
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
    stagingEnvironmentPolicy: 'Disabled'
    allowConfigFileUpdates: true
  }
}

/*
  This resource REPLACES the entire app-settings collection on every deployment.
  A secret added by hand afterwards is deleted by the next run, and a parameter
  left empty is a deletion rather than a no-op - so the deploy script asserts
  every value is present and printable before it gets here.

  There are no Key Vault references below on purpose: a managed Static Web Apps
  function cannot resolve them.
*/
resource appSettings 'Microsoft.Web/staticSites/config@2024-04-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    COSMOS_ENDPOINT: cosmosEndpoint
    COSMOS_KEY: cosmosKey
    COSMOS_DATABASE: cosmosDatabase

    // Selects the principal parser explicitly. App Service Easy Auth and Static
    // Web Apps inject the same header name with different payloads; a parser
    // that guessed would fail open on the platform it was not written for.
    AUTH_MODE: 'swa'

    ADMIN_EMAIL_DOMAINS: adminEmailDomains

    // Both are needed. The instrumentation key is what the portal's
    // "Enable Application Insights" writes, and some tooling still reads it.
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
    APPINSIGHTS_INSTRUMENTATIONKEY: appInsights.properties.InstrumentationKey
  }
}

/*
  Two-pass: the domain cannot validate until DNS points at the site, and the
  CNAME cannot be written until the site exists and has a hostname. Deploy once
  with customDomain empty, add the CNAME, then deploy again with it set.
*/
resource domain 'Microsoft.Web/staticSites/customDomains@2024-04-01' = if (!empty(customDomain)) {
  parent: staticWebApp
  name: customDomain
  properties: {
    validationMethod: 'cname-delegation'
  }
}

output staticWebAppName string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname

// Follows the binding rather than the intent, so the first pass yields a URL
// that actually resolves instead of one that does not yet.
output appUrl string = empty(customDomain)
  ? 'https://${staticWebApp.properties.defaultHostname}'
  : 'https://${customDomain}'
