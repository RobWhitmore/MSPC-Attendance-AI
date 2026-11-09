// Cosmos DB (free tier) and the Key Vault that is the store of record for secrets.

param appName string
param location string
param keyVaultAdminObjectId string = ''

var cosmosAccountName = toLower('cosmos-${appName}-${uniqueString(resourceGroup().id)}')
var keyVaultName = toLower('kv-${appName}-${uniqueString(resourceGroup().id)}')
var databaseName = 'mspc'

/*
  enableFreeTier grants 1000 RU/s and 25 GB at no cost, and is limited to ONE
  account per subscription. It can only be set at creation - an account created
  without it cannot be converted, it has to be recreated.

  totalThroughputLimit caps the account at the free grant, so a mistake in a
  container definition cannot quietly start billing.
*/
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true
    enableAutomaticFailover: false
    disableLocalAuth: false
    minimalTlsVersion: 'Tls12'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capacity: {
      totalThroughputLimit: 1000
    }
    backupPolicy: {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 1440
        backupRetentionIntervalInHours: 48
        backupStorageRedundancy: 'Local'
      }
    }
  }
}

/*
  Shared throughput. The free grant is account-level, so one reservation across
  every container beats seven separate ones - and a shared database supports up
  to 25 containers, comfortably more than the eight here.
*/
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
    options: {
      throughput: 1000
    }
  }
}

// Partition keys mirror the table in ARCHITECTURE.md and cannot be changed later.
var containers = [
  { name: 'people', partitionKey: '/id' }
  { name: 'groups', partitionKey: '/id' }
  { name: 'groupTypes', partitionKey: '/id' }
  { name: 'events', partitionKey: '/groupId' }
  { name: 'rosters', partitionKey: '/eventId' }
  { name: 'groupMembers', partitionKey: '/groupId' }
  { name: 'admins', partitionKey: '/id' }
  { name: 'auditLogs', partitionKey: '/collectionId' }
]

resource containerResources 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = [
  for c in containers: {
    parent: database
    name: c.name
    properties: {
      resource: {
        id: c.name
        partitionKey: {
          paths: [c.partitionKey]
          kind: 'Hash'
        }
        indexingPolicy: {
          indexingMode: 'consistent'
          automatic: true
          includedPaths: [{ path: '/*' }]
          excludedPaths: [{ path: '/"_etag"/?' }]
        }
      }
    }
  }
]

/*
  Key Vault is the store of record, not a runtime dependency: managed Static Web
  Apps functions cannot resolve Key Vault references, so the deployment reads
  secrets out of here and writes them into app settings.
*/
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

// Key Vault Secrets Officer, so the named principal can read and write secrets.
var secretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource keyVaultAdmin 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(keyVaultAdminObjectId)) {
  scope: keyVault
  name: guid(keyVault.id, keyVaultAdminObjectId, secretsOfficerRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsOfficerRoleId)
    principalId: keyVaultAdminObjectId
    principalType: 'User'
  }
}

output cosmosAccountName string = cosmos.name
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output cosmosDatabase string = databaseName
output keyVaultName string = keyVault.name
