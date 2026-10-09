import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import Security
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct AppUpdateClient {
    let session: URLSession
    let apiURL: URL

    init(session: URLSession = .shared) {
        self.session = session
        let configured = ProcessInfo.processInfo.environment["HANASAND_APP_UPDATE_API"] ?? "https://api.hanasand.com/api/app"
        apiURL = URL(string: configured) ?? URL(string: "https://api.hanasand.com/api/app")!
    }

    func fetchManifest(currentVersion: String) async throws -> AppUpdateManifest {
        var components = URLComponents(url: apiURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "platform", value: "macos"),
            URLQueryItem(name: "version", value: currentVersion),
        ]
        guard let url = components?.url else {
            throw UpdateError.invalidURL
        }

        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try JSONDecoder().decode(AppUpdateManifest.self, from: data)
    }

    func download(manifest: AppUpdateManifest) async throws -> URL {
        guard let expectedChecksum = manifest.sha256,
              expectedChecksum.count == 64,
              expectedChecksum.allSatisfy({ $0.isHexDigit }) else {
            throw UpdateError.invalidChecksum
        }
        guard manifest.downloadURL.scheme?.lowercased() == "https" else {
            throw UpdateError.invalidURL
        }
        let (temporaryURL, response) = try await session.download(from: manifest.downloadURL)
        defer { try? FileManager.default.removeItem(at: temporaryURL) }
        try validate(response: response)
        let actual = try sha256(for: temporaryURL)
        guard actual.caseInsensitiveCompare(expectedChecksum) == .orderedSame else {
            throw UpdateError.checksumMismatch
        }

        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = support.appendingPathComponent("Hanasand/Updates", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let ext = manifest.downloadURL.pathExtension.isEmpty ? "bin" : manifest.downloadURL.pathExtension
        let destination = directory.appendingPathComponent("Hanasand-\(manifest.latestVersion).\(ext)")
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.moveItem(at: temporaryURL, to: destination)

        return destination
    }

    func installDownloadedApp(from archiveURL: URL) async throws -> URL {
        try await Task.detached(priority: .utility) {
            let fileManager = FileManager.default
            let support = try fileManager.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let installRoot = support
                .appendingPathComponent("Hanasand/Install", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try fileManager.createDirectory(at: installRoot, withIntermediateDirectories: true)
            defer { try? fileManager.removeItem(at: installRoot) }

            guard archiveURL.pathExtension.lowercased() == "zip" else {
                throw UpdateError.unsupportedPackage
            }

            try Self.runProcess(executable: "/usr/bin/ditto", arguments: ["-x", "-k", archiveURL.path, installRoot.path])

            guard let newApp = Self.findAppBundle(in: installRoot, preferredName: "Hanasand.app") else {
                throw UpdateError.invalidPackage
            }

            let currentApp = Bundle.main.bundleURL
            guard currentApp.pathExtension.lowercased() == "app" else {
                throw UpdateError.unsupportedBundleLocation
            }
            guard let currentBundleID = Bundle.main.bundleIdentifier,
                  let updatedBundleID = Bundle(url: newApp)?.bundleIdentifier,
                  updatedBundleID == currentBundleID else {
                throw UpdateError.bundleIdentifierMismatch
            }
            guard let currentTeamID = try Self.signedTeamIdentifier(for: currentApp, validateSignature: false),
                  let updatedTeamID = try Self.signedTeamIdentifier(for: newApp, validateSignature: true) else {
                throw UpdateError.signatureValidationFailed
            }
            guard updatedTeamID == currentTeamID else {
                throw UpdateError.teamIdentifierMismatch
            }

            let destination = currentApp.deletingLastPathComponent().appendingPathComponent(currentApp.lastPathComponent)
            if fileManager.fileExists(atPath: destination.path) {
                _ = try fileManager.replaceItemAt(destination, withItemAt: newApp, backupItemName: nil, options: [])
            } else {
                try fileManager.moveItem(at: newApp, to: destination)
            }

            return destination
        }.value
    }

    func validate(response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw UpdateError.httpStatus(http.statusCode)
        }
    }

    func sha256(for url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func findAppBundle(in directory: URL, preferredName: String) -> URL? {
        let preferred = directory.appendingPathComponent(preferredName, isDirectory: true)
        if FileManager.default.fileExists(atPath: preferred.path) {
            return preferred
        }

        let keys: [URLResourceKey] = [.isDirectoryKey]
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        ) else {
            return nil
        }

        for case let url as URL in enumerator {
            if url.pathExtension.lowercased() == "app" {
                enumerator.skipDescendants()
                return url
            }
        }

        return nil
    }

    static func runProcess(executable: String, arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw UpdateError.installFailed("\(URL(fileURLWithPath: executable).lastPathComponent) exited with \(process.terminationStatus)")
        }
    }

    static func signedTeamIdentifier(for appURL: URL, validateSignature: Bool) throws -> String? {
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(appURL as CFURL, [], &staticCode) == errSecSuccess,
              let staticCode else {
            throw UpdateError.signatureValidationFailed
        }
        if validateSignature {
            guard SecStaticCodeCheckValidity(staticCode, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess else {
                throw UpdateError.signatureValidationFailed
            }
        }

        var information: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
              let information = information as? [String: Any] else {
            throw UpdateError.signatureValidationFailed
        }
        return information[kSecCodeInfoTeamIdentifier as String] as? String
    }
}
