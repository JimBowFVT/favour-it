// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FavouritToken} from "../src/FavouritToken.sol";

contract TokenActor {
    function tryMint(FavouritToken token, address to, uint256 amount) external returns (bool) {
        (bool ok,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", to, amount));
        return ok;
    }

    function tryTransfer(FavouritToken token, address to, uint256 amount) external returns (bool) {
        (bool ok,) = address(token).call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        return ok;
    }

    function tryIncreaseCap(FavouritToken token, uint256 newCap) external returns (bool) {
        (bool ok,) = address(token).call(abi.encodeWithSignature("increaseMaxSupply(uint256)", newCap));
        return ok;
    }

    function tryPause(FavouritToken token) external returns (bool) {
        (bool ok,) = address(token).call(abi.encodeWithSignature("pause()"));
        return ok;
    }
}

contract FavouritTokenTest {
    uint256 internal constant UNIT = 1_000_000;

    function deploy(uint256 cap) internal returns (FavouritToken) {
        return new FavouritToken(address(this), address(this), cap);
    }

    function testMetadataAndLedgerPrecisionMatch() public {
        FavouritToken token = deploy(10_000_000 * UNIT);
        require(keccak256(bytes(token.name())) == keccak256(bytes("Favourit")), "wrong name");
        require(keccak256(bytes(token.symbol())) == keccak256(bytes("FAV")), "wrong symbol");
        require(token.decimals() == 6, "wrong decimals");
        require(token.maxSupply() == 10_000_000 * UNIT, "wrong cap");
        require(token.totalSupply() == 0, "supply should start at zero");
    }

    function testAuthorizedMinterCanMintExactMicroFavUnits() public {
        FavouritToken token = deploy(10 * UNIT);
        TokenActor recipient = new TokenActor();

        token.mint(address(recipient), 2_500_001);

        require(token.balanceOf(address(recipient)) == 2_500_001, "mint amount changed");
        require(token.totalSupply() == 2_500_001, "wrong total supply");
    }

    function testUnauthorizedAccountCannotMint() public {
        FavouritToken token = deploy(10 * UNIT);
        TokenActor attacker = new TokenActor();

        require(!attacker.tryMint(token, address(attacker), UNIT), "unauthorized mint succeeded");
        require(token.totalSupply() == 0, "unauthorized mint changed supply");
    }

    function testMintCannotCrossCap() public {
        FavouritToken token = deploy(2 * UNIT);
        token.mint(address(this), 2 * UNIT);

        (bool ok,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        require(!ok, "mint crossed cap");
        require(token.totalSupply() == 2 * UNIT, "supply changed after rejected mint");
    }

    function testCapCanOnlyIncreaseByCapManager() public {
        FavouritToken token = deploy(10 * UNIT);
        TokenActor attacker = new TokenActor();

        require(!attacker.tryIncreaseCap(token, 20 * UNIT), "unauthorized cap increase succeeded");

        token.increaseMaxSupply(20 * UNIT);
        require(token.maxSupply() == 20 * UNIT, "cap did not increase");

        (bool sameCapOk,) = address(token).call(abi.encodeWithSignature("increaseMaxSupply(uint256)", 20 * UNIT));
        require(!sameCapOk, "same cap should fail");
    }

    function testPauseStopsTransfersAndMintingUntilUnpaused() public {
        FavouritToken token = deploy(10 * UNIT);
        TokenActor holder = new TokenActor();
        TokenActor recipient = new TokenActor();
        TokenActor attacker = new TokenActor();

        token.mint(address(holder), 3 * UNIT);
        require(!attacker.tryPause(token), "unauthorized pause succeeded");

        token.pause();
        require(!holder.tryTransfer(token, address(recipient), UNIT), "transfer succeeded while paused");

        (bool mintWhilePaused,) = address(token).call(
            abi.encodeWithSignature("mint(address,uint256)", address(recipient), UNIT)
        );
        require(!mintWhilePaused, "mint succeeded while paused");

        token.unpause();
        require(holder.tryTransfer(token, address(recipient), UNIT), "transfer failed after unpause");
        require(token.balanceOf(address(recipient)) == UNIT, "transfer was not exact");
        require(token.balanceOf(address(holder)) == 2 * UNIT, "sender balance incorrect");
    }
}
