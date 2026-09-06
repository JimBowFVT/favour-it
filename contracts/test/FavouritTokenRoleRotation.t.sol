// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FavouritToken} from "../src/FavouritToken.sol";

contract MinterActor {
    function mint(
        FavouritToken token,
        bytes32 mintRef,
        address to,
        uint256 amount
    ) external returns (bool) {
        (bool ok,) = address(token).call(
            abi.encodeWithSignature(
                "mintWithReference(bytes32,address,uint256)",
                mintRef,
                to,
                amount
            )
        );
        return ok;
    }

    function grantMinter(FavouritToken token, address account) external returns (bool) {
        (bool ok,) = address(token).call(
            abi.encodeWithSignature(
                "grantRole(bytes32,address)",
                token.MINTER_ROLE(),
                account
            )
        );
        return ok;
    }
}

contract FavouritTokenRoleRotationTest {
    uint256 private constant UNIT = 1_000_000;

    function testAdminCanRotateMinterWithoutChangingAdminRoles() public {
        MinterActor firstMinter = new MinterActor();
        MinterActor secondMinter = new MinterActor();
        FavouritToken token = new FavouritToken(
            address(this),
            address(firstMinter),
            10_000_000 * UNIT
        );

        bytes32 minterRole = token.MINTER_ROLE();
        bytes32 adminRole = token.DEFAULT_ADMIN_ROLE();
        bytes32 capRole = token.CAP_MANAGER_ROLE();
        bytes32 pauserRole = token.PAUSER_ROLE();

        require(token.hasRole(minterRole, address(firstMinter)), "initial minter missing");
        require(token.hasRole(adminRole, address(this)), "admin role missing");
        require(token.hasRole(capRole, address(this)), "cap role missing");
        require(token.hasRole(pauserRole, address(this)), "pauser role missing");

        require(
            firstMinter.mint(token, keccak256("first-minter"), address(this), UNIT),
            "initial minter could not mint"
        );

        token.grantRole(minterRole, address(secondMinter));
        token.revokeRole(minterRole, address(firstMinter));

        require(!token.hasRole(minterRole, address(firstMinter)), "old minter still authorized");
        require(token.hasRole(minterRole, address(secondMinter)), "new minter not authorized");
        require(
            !firstMinter.mint(token, keccak256("revoked-minter"), address(this), UNIT),
            "revoked minter could still mint"
        );
        require(
            secondMinter.mint(token, keccak256("second-minter"), address(this), UNIT),
            "new minter could not mint"
        );

        require(token.totalSupply() == 2 * UNIT, "unexpected supply after rotation");
        require(token.hasRole(adminRole, address(this)), "admin changed during rotation");
        require(token.hasRole(capRole, address(this)), "cap manager changed during rotation");
        require(token.hasRole(pauserRole, address(this)), "pauser changed during rotation");
    }

    function testNonAdminCannotRotateMinter() public {
        MinterActor currentMinter = new MinterActor();
        MinterActor attacker = new MinterActor();
        FavouritToken token = new FavouritToken(
            address(this),
            address(currentMinter),
            10_000_000 * UNIT
        );

        bytes32 minterRole = token.MINTER_ROLE();
        require(
            !attacker.grantMinter(token, address(attacker)),
            "non-admin role rotation unexpectedly succeeded"
        );
        require(!token.hasRole(minterRole, address(attacker)), "attacker received minter role");
        require(token.hasRole(minterRole, address(currentMinter)), "current minter was changed");
    }
}
