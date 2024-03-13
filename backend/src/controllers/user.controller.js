import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { sendEmail } from "../utils/sendEmail.js";
// await sendEmail("account_activation", email, activateToken);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generateAccessAndRefereshTokens = async (userId) => {
   try {
      const user = await User.findById(userId);
      const accessToken = user.generateAccessToken();
      const refreshToken = user.generateRefreshToken();

      user.refreshToken = refreshToken;
      await user.save({ validateBeforeSave: false });

      return { accessToken, refreshToken };
   } catch (error) {
      throw new ApiError(
         500,
         "Something went wrong while generating referesh and access token"
      );
   }
};

const registerUser = asyncHandler(async (req, res) => {
   const { fullName, email, password, gender } = req.body;
   if ([fullName, email, password].some((field) => field?.trim() === "")) {
      throw new ApiError(400, "All fields are required");
   }

   const existedUser = await User.findOne({ email });

   if (existedUser) {
      throw new ApiError(409, 1000, "User with email already exists");
   }

   const user = await User.create({
      email,
      fullName,
      password,
      gender,
   });

   const createdUser = await User.findById(user._id).select(
      "-password -refreshToken"
   );

   if (!createdUser) {
      throw new ApiError(
         500,
         "Something went wrong while registering the user"
      );
   }

   return res
      .status(201)
      .json(
         new ApiResponse(200, createdUser, "User registered Successfully", 1002)
      );
});

const loginUser = asyncHandler(async (req, res) => {
   const { email, password } = req.body;

   if (!email) {
      throw new ApiError(405, "Email or password is required");
   }

   const user = await User.findOne({ email: email });

   if (!user) {
      throw new ApiError(402, "User does not exist");
   }

   const isPasswordValid = await user.isPasswordCorrect(password);

   if (!isPasswordValid) {
      throw new ApiError(401, "Invalid user credentials");
   }

   const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(
      user._id
   );

   const loggedInUser = await User.findById(user._id).select(
      "-password -refreshToken"
   );

   const options = {
      httpOnly: true,
      secure: true,
   };

   return res
      .status(200)
      .cookie("accessToken", accessToken, {})
      .cookie("refreshToken", refreshToken, options)
      .json(
         new ApiResponse(
            200,
            {
               user: loggedInUser,
               accessToken,
               refreshToken,
            },
            "User logged In Successfully",
            2005
         )
      );
});

const loginUserWithToken = asyncHandler(async (req, res) => {
   const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(
      req.user._id
   );

   const loggedInUser = await User.findById(req.user._id).select(
      "-password -refreshToken"
   );
   const options = {
      httpOnly: true,
      secure: true,
   };

   return res
      .status(200)
      .cookie("accessToken", accessToken, {})
      .cookie("refreshToken", refreshToken, options)
      .json(
         new ApiResponse(
            200,
            {
               user: loggedInUser,
               accessToken,
               refreshToken,
            },
            "User logged In Successfully",
            2005
         )
      );
});

const logoutUser = asyncHandler(async (req, res) => {
   await User.findByIdAndUpdate(
      req.user._id,
      {
         $unset: {
            refreshToken: 1, // this removes the field from document
         },
      },
      {
         new: true,
      }
   );

   const options = {
      httpOnly: true,
      secure: true,
   };

   return res
      .status(200)
      .clearCookie("accessToken", {})
      .clearCookie("refreshToken", options)
      .json(new ApiResponse(200, {}, "User logged Out"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
   const incomingRefreshToken =
      req.cookies.refreshToken || req.body.refreshToken;

   if (!incomingRefreshToken) {
      throw new ApiError(401, "unauthorized request");
   }

   try {
      const decodedToken = jwt.verify(
         incomingRefreshToken,
         process.env.REFRESH_TOKEN_SECRET
      );

      const user = await User.findById(decodedToken?._id);

      if (!user) {
         throw new ApiError(401, "Invalid refresh token");
      }

      if (incomingRefreshToken !== user?.refreshToken) {
         throw new ApiError(401, "Refresh token is expired or used");
      }

      const options = {
         httpOnly: true,
         secure: true,
      };

      const { accessToken, newRefreshToken } =
         await generateAccessAndRefereshTokens(user._id);

      return res
         .status(200)
         .cookie("accessToken", accessToken, options)
         .cookie("refreshToken", newRefreshToken, options)
         .json(
            new ApiResponse(
               200,
               { accessToken, refreshToken: newRefreshToken },
               "Access token refreshed"
            )
         );
   } catch (error) {
      throw new ApiError(401, error?.message || "Invalid refresh token");
   }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
   const { oldPassword, newPassword } = req.body;

   const user = await User.findById(req.user?._id);
   const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

   if (!isPasswordCorrect) {
      throw new ApiError(400, "Invalid old password");
   }

   user.password = newPassword;
   await user.save({ validateBeforeSave: false });

   return res
      .status(200)
      .json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
   // success, statusCode, data
   return res
      .status(200)
      .json(new ApiResponse(200, req.user, "User fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
   const { fullName, bio } = req.body;

   if (!fullName || !bio) {
      throw new ApiError(400, "All fields are required");
   }

   const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
         $set: {
            fullName,
            bio: bio,
         },
      },
      { new: true }
   ).select("-password -refreshToken -activationToken");

   return res
      .status(200)
      .json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
   const avatarLocalPath = req.file?.path;

   if (!avatarLocalPath) {
      throw new ApiError(400, "Avatar file is missing");
   }

   //TODO: delete old image - assignment

   const avatar = await uploadOnCloudinary(avatarLocalPath);

   if (!avatar.url) {
      throw new ApiError(400, "Error while uploading on avatar");
   }

   const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
         $set: {
            avatar: avatar.url,
         },
      },
      { new: true }
   ).select("-password");

   return res
      .status(200)
      .json(new ApiResponse(200, user, "Avatar image updated successfully"));
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
   const coverImageLocalPath = req.file?.path;

   if (!coverImageLocalPath) {
      throw new ApiError(400, "Cover image file is missing");
   }

   //TODO: delete old image - assignment

   const coverImage = await uploadOnCloudinary(coverImageLocalPath);

   if (!coverImage.url) {
      throw new ApiError(400, "Error while uploading on avatar");
   }

   const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
         $set: {
            coverImage: coverImage.url,
         },
      },
      { new: true }
   ).select("-password");

   return res
      .status(200)
      .json(new ApiResponse(200, user, "Cover image updated successfully"));
});

// Email Actions

const sendActivationEmail = asyncHandler(async (req, res) => {
   try {
      const user = req?.user;

      if (!user) {
         throw new ApiError(401, "Unauthorized request");
      }

      const userId = req.user._id;

      const findUser = await User.findById(userId);

      if (!findUser) {
         throw new ApiError(402, `User doesn't exists`);
      }

      const params = findUser.generateAccountActivationToken();

      findUser.activationToken = params;

      await findUser.save();

      await sendEmail("ACCOUNT_ACTIVATION", user.email, params);

      return res
         .status(200)
         .json(new ApiResponse(200, [], "Email sent!", 5002));
   } catch (error) {
      throw new ApiError(500, error?.messgae || "Something went wrong");
   }
});

const checkActivationEmail = asyncHandler(async (req, res) => {
   try {
      const { email, activationToken } = req.params;
      const user = await User.findOne({
         $and: [{ email: email }, { activationToken: activationToken }],
      }).select("-password -refreshToken");

      if (!user) {
         throw new ApiError(405, "Token is expired or used");
      }

      user.isActivated = true;
      user.activationToken = "";

      await user.save();

      return res
         .status(200)
         .json(new ApiResponse(200, [], "Account activation success", 6002));
   } catch (error) {
      // Sending HTML file in case of error
      res.status(500).sendFile(
         path.join(__dirname, "/html/expired-token.html")
      );
   }
});

const searchUser = asyncHandler(async (req, res) => {
   const { query } = req.params;

   if (query?.trim() === "") {
      throw new ApiError(404, "Enter a query to search");
   }

   const keywords = query?.trim()?.toLowerCase().split(/\s+/); // Convert search query to lowercase

   const result = await User.aggregate([
      {
         $match: {
            $or: [
               {
                  fullName: {
                     $in: keywords.map((keyword) => new RegExp(keyword, "i")),
                  },
               }, // Perform case-insensitive search on fullName
               {
                  email: {
                     $in: keywords.map((keyword) => new RegExp(keyword, "i")),
                  },
               }, // Perform case-insensitive search on email
            ],
         },
      },
      {
         $project: {
            _id: 1,
            fullName: 1,
            email: 1,
            bio: 1,
         },
      },
   ]);

   return res
      .status(200)
      .json(
         new ApiResponse(
            200,
            result,
            "Searched user retrieved successfully",
            6001
         )
      );
});

const getUserWithId = asyncHandler(async (req, res) => {
   const { userId } = req.params;

   if (!userId) {
      throw new ApiError(404, "UserId is undefined");
   }

   const user = await User.findById(userId);

   if (!user) {
      throw new ApiError(400, "User doesn't exists");
   }

   return res
      .status(200)
      .json(new ApiResponse(200, user, "User fetched successfully", 9000));
});

export {
   registerUser,
   loginUser,
   loginUserWithToken,
   logoutUser,
   refreshAccessToken,
   changeCurrentPassword,
   getCurrentUser,
   updateAccountDetails,
   updateUserAvatar,
   updateUserCoverImage,
   // Email
   sendActivationEmail,
   checkActivationEmail,
   searchUser,
   getUserWithId,
};
