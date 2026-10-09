import Foundation
import Security

enum DesktopCredential: String {
    case authToken
    case impersonationToken
}

enum DesktopCredentialStore {
    private static let service = "com.hanasand.desktop.credentials"

    static func read(_ credential: DesktopCredential) throws -> String? {
        var query = baseQuery(for: credential)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            throw DesktopCredentialStoreError.keychain(status)
        }
        return value
    }

    static func write(_ value: String, for credential: DesktopCredential) throws {
        let data = Data(value.utf8)
        let query = baseQuery(for: credential)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw DesktopCredentialStoreError.keychain(updateStatus)
        }

        var insert = query
        attributes.forEach { insert[$0.key] = $0.value }
        let insertStatus = SecItemAdd(insert as CFDictionary, nil)
        guard insertStatus == errSecSuccess else {
            throw DesktopCredentialStoreError.keychain(insertStatus)
        }
    }

    private static func baseQuery(for credential: DesktopCredential) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: credential.rawValue,
        ]
    }
}

enum DesktopCredentialStoreError: LocalizedError {
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .keychain(let status):
            return "The Hanasand session could not be saved in Keychain (error \(status))."
        }
    }
}
