import CryptoKit
import Darwin
import Foundation
import Network
import Security
import SwiftASN1
import X509

/// A per-user macOS Keychain identity for the local agent's HTTPS listener.
/// The private key never leaves Keychain; X509 signs the leaf certificate by
/// wrapping the Keychain SecKey directly.
struct LoopbackTLSServerIdentity {
    let identity: SecIdentity
    let certificateDER: Data
    let certificateSHA256: String
    let advertisedIPv4Addresses: [String]

    static let keychainNamespace = "desktop-local-agent-v1"
    static let minimumTLSVersion: tls_protocol_version_t = .TLSv12

    static func load(advertising addresses: [String], namespace: String = keychainNamespace) throws -> LoopbackTLSServerIdentity {
        let normalizedAddresses = Array(Set(addresses)).sorted()
        guard normalizedAddresses.allSatisfy(isIPv4Address) else {
            throw IdentityError.invalidIPv4Address
        }

        let labels = try keychainLabels(namespace: namespace)
        let key = try loadOrCreatePrivateKey(labels: labels)
        let keychainCertificate = try loadCertificateDER(label: labels.certificate)
        let certificateDER: Data
        if let keychainCertificate,
           certificateIsCurrent(keychainCertificate, advertisedIPv4Addresses: normalizedAddresses) {
            certificateDER = keychainCertificate
        } else {
            certificateDER = try makeCertificate(privateKey: key, advertisedIPv4Addresses: normalizedAddresses)
            try saveCertificateDER(certificateDER, label: labels.certificate)
        }

        guard let certificate = SecCertificateCreateWithData(nil, certificateDER as CFData) else {
            throw IdentityError.invalidCertificate
        }
        var secIdentity: SecIdentity?
        let status = SecIdentityCreateWithCertificate(nil, certificate, &secIdentity)
        guard status == errSecSuccess, let secIdentity else {
            throw IdentityError.keychain(status)
        }

        let fingerprint = SHA256.hash(data: certificateDER)
            .map { String(format: "%02x", $0) }
            .joined()
        return LoopbackTLSServerIdentity(
            identity: secIdentity,
            certificateDER: certificateDER,
            certificateSHA256: fingerprint,
            advertisedIPv4Addresses: normalizedAddresses
        )
    }

    static func makeTLSParameters(identity: SecIdentity) throws -> NWParameters {
        let tlsOptions = NWProtocolTLS.Options()
        sec_protocol_options_set_min_tls_protocol_version(
            tlsOptions.securityProtocolOptions,
            minimumTLSVersion
        )
        guard let networkIdentity = sec_identity_create(identity) else {
            throw IdentityError.invalidCertificate
        }
        sec_protocol_options_set_local_identity(tlsOptions.securityProtocolOptions, networkIdentity)
        return NWParameters(tls: tlsOptions, tcp: NWProtocolTCP.Options())
    }

    static func removeKeychainIdentity(namespace: String) throws {
        let labels = try keychainLabels(namespace: namespace)
        let keyQuery: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeyClass: kSecAttrKeyClassPrivate,
            kSecAttrApplicationTag: labels.applicationTag,
        ]
        let keyStatus = SecItemDelete(keyQuery as CFDictionary)
        guard keyStatus == errSecSuccess || keyStatus == errSecItemNotFound else {
            throw IdentityError.keychain(keyStatus)
        }
        let certificateQuery: [CFString: Any] = [kSecClass: kSecClassCertificate, kSecAttrLabel: labels.certificate]
        let certificateStatus = SecItemDelete(certificateQuery as CFDictionary)
        guard certificateStatus == errSecSuccess || certificateStatus == errSecItemNotFound else {
            throw IdentityError.keychain(certificateStatus)
        }
    }

    private static func keychainLabels(namespace: String) throws -> (applicationTag: Data, key: String, certificate: String) {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.")
        guard !namespace.isEmpty, namespace.count <= 80, namespace.unicodeScalars.allSatisfy(allowed.contains) else {
            throw IdentityError.invalidNamespace
        }
        let prefix = "com.hanasand.desktop.local-agent.tls.\(namespace)"
        return (Data(prefix.utf8), "Hanasand Local Agent TLS P-256 Key (\(namespace))", "Hanasand Local Agent TLS Leaf Certificate (\(namespace))")
    }

    private static func loadOrCreatePrivateKey(labels: (applicationTag: Data, key: String, certificate: String)) throws -> SecKey {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeyClass: kSecAttrKeyClassPrivate,
            kSecAttrApplicationTag: labels.applicationTag,
            kSecReturnRef: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let item {
            let key = item as! SecKey
            try validateP256PrivateKey(key)
            return key
        }
        guard status == errSecItemNotFound else { throw IdentityError.keychain(status) }

        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecPrivateKeyAttrs: [
                kSecAttrIsPermanent: true,
                kSecAttrApplicationTag: labels.applicationTag,
                kSecAttrLabel: labels.key,
            ],
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw IdentityError.keyGeneration(error?.takeRetainedValue())
        }
        try validateP256PrivateKey(key)
        return key
    }

    private static func validateP256PrivateKey(_ key: SecKey) throws {
        guard let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
              let keyType = attributes[kSecAttrKeyType], CFEqual(keyType as CFTypeRef, kSecAttrKeyTypeECSECPrimeRandom),
              let keyClass = attributes[kSecAttrKeyClass], CFEqual(keyClass as CFTypeRef, kSecAttrKeyClassPrivate),
              attributes[kSecAttrKeySizeInBits] as? Int == 256 else {
            throw IdentityError.invalidPrivateKey
        }
    }

    private static func loadCertificateDER(label: String) throws -> Data? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassCertificate,
            kSecAttrLabel: label,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw IdentityError.keychain(status)
        }
        return data
    }

    private static func saveCertificateDER(_ der: Data, label: String) throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassCertificate,
            kSecAttrLabel: label,
        ]
        let deleteStatus = SecItemDelete(query as CFDictionary)
        guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
            throw IdentityError.keychain(deleteStatus)
        }
        let add: [CFString: Any] = [
            kSecClass: kSecClassCertificate,
            kSecAttrLabel: label,
            kSecValueData: der,
        ]
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw IdentityError.keychain(status) }
    }

    static func certificateIsCurrent(_ der: Data, advertisedIPv4Addresses: [String]) -> Bool {
        guard let certificate = try? Certificate(derEncoded: Array(der)),
              certificate.notValidBefore <= Date(),
              certificate.notValidAfter > Date().addingTimeInterval(60 * 60 * 24 * 30),
              let sanExtension = certificate.extensions.first(where: { $0.oid == .X509ExtensionID.subjectAlternativeName }),
              let names = try? SubjectAlternativeNames(sanExtension) else {
            return false
        }

        var dnsNames: [String] = []
        var ipAddresses: [String] = []
        for name in names {
            switch name {
            case .dnsName(let name): dnsNames.append(name)
            case .ipAddress(let octets):
                if let ip = ipv4String(from: Array(octets.bytes)) { ipAddresses.append(ip) }
            default: break
            }
        }
        return Set(dnsNames) == Set(["localhost"]) && Set(ipAddresses) == Set(advertisedIPv4Addresses)
    }

    static func makeCertificate(privateKey secKey: SecKey, advertisedIPv4Addresses: [String]) throws -> Data {
        let privateKey = try Certificate.PrivateKey(secKey)
        let subject = try DistinguishedName {
            CommonName("Hanasand Local Agent")
        }
        var names: [GeneralName] = [.dnsName("localhost")]
        for address in advertisedIPv4Addresses {
            guard let octets = ipv4Bytes(address) else { throw IdentityError.invalidIPv4Address }
            names.append(.ipAddress(ASN1OctetString(contentBytes: octets[...])) )
        }
        let now = Date()
        let certificate = try Certificate(
            version: .v3,
            serialNumber: Certificate.SerialNumber(),
            publicKey: privateKey.publicKey,
            notValidBefore: now.addingTimeInterval(-60),
            notValidAfter: now.addingTimeInterval(60 * 60 * 24 * 365),
            issuer: subject,
            subject: subject,
            signatureAlgorithm: .ecdsaWithSHA256,
            extensions: Certificate.Extensions {
                Critical(BasicConstraints.notCertificateAuthority)
                Critical(KeyUsage(digitalSignature: true))
                try ExtendedKeyUsage([.serverAuth])
                SubjectAlternativeNames(names)
            },
            issuerPrivateKey: privateKey
        )
        var serializer = DER.Serializer()
        try serializer.serialize(certificate)
        return Data(serializer.serializedBytes)
    }

    private static func isIPv4Address(_ address: String) -> Bool {
        ipv4Bytes(address) != nil
    }

    private static func ipv4Bytes(_ address: String) -> [UInt8]? {
        var parsed = in_addr()
        guard address.withCString({ inet_pton(AF_INET, $0, &parsed) }) == 1 else { return nil }
        return withUnsafeBytes(of: parsed.s_addr) { Array($0) }
    }

    private static func ipv4String(from bytes: [UInt8]) -> String? {
        guard bytes.count == 4 else { return nil }
        let value = UInt32(bytes[0]) << 24 | UInt32(bytes[1]) << 16 | UInt32(bytes[2]) << 8 | UInt32(bytes[3])
        var address = in_addr(s_addr: value.bigEndian)
        var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        guard inet_ntop(AF_INET, &address, &buffer, socklen_t(buffer.count)) != nil else { return nil }
        return String(cString: buffer)
    }

    private enum IdentityError: LocalizedError {
        case invalidIPv4Address
        case invalidNamespace
        case invalidPrivateKey
        case invalidCertificate
        case keychain(OSStatus)
        case keyGeneration(CFError?)

        var errorDescription: String? {
            switch self {
            case .invalidIPv4Address: return "The local agent received an invalid IPv4 address for its TLS certificate."
            case .invalidNamespace: return "The local agent TLS Keychain namespace is invalid."
            case .invalidPrivateKey: return "The local agent Keychain key is not a P-256 private key."
            case .invalidCertificate: return "The local agent TLS certificate could not be loaded as a Keychain identity."
            case .keychain(let status): return "The local agent TLS identity could not be accessed in Keychain (Security error \(status))."
            case .keyGeneration(let error): return "The local agent TLS private key could not be created in Keychain: \(error?.localizedDescription ?? "unknown Security error")."
            }
        }
    }
}
