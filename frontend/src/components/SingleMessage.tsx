import React, {
  useRef,
  useEffect,
  useContext,
  useState,
  ChangeEvent,
  useCallback,
} from "react";
import "../styles/singlemessage.css";
import { IoCall, IoVideocam } from "react-icons/io5";

import { MdOutlineAttachFile } from "react-icons/md";
import MyMessagePart from "../sub-components/MyMessagePart";
import OtherPersonMessagePart from "../sub-components/OtherPersonMessagePart";
import { ToggleProfile } from "../context/ToggleProfile";
import { BiArrowBack } from "react-icons/bi";
import { useNavigate, useParams } from "react-router-dom";
import { IoMdSend } from "react-icons/io";
import Spinner from "./Spinner";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../types/Rootstate";
import { formatDateForInitialChatCreationAlert } from "../utils/messageDateFormat";
import { Socket } from "socket.io-client";
import { getAllMessagesWithId } from "../apis/chatActions";
import { saveMessages } from "../features/messages/messageSlice";
import { sendFileToServer } from "../utils/sendFileToServer";
import { useDropzone } from "react-dropzone";
export default function SingleMessage({ socket }: { socket: Socket | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [typingAlertText, setTypingAlertText] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [messageValue, setMessageValue] = useState("");
  const [showTyping, setShowTyping] = useState(false);

  const onDrop = useCallback((acceptedFiles: Array<File>) => {
    setFile(acceptedFiles[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });
  const [loader, setLoader] = useState(true);
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const showProfileOptions = useContext(ToggleProfile);
  if (!showProfileOptions) {
    return null;
  }
  const dispatch = useDispatch();
  const { setShowProfile, showProfile } = showProfileOptions;
  const { chatId } = useParams();
  const loggedInUser = useSelector(
    (state: RootState) => state.auth.loggedInUser
  );
  const chats = useSelector((state: RootState) => state.chats.allChatCards);

  const messages = useSelector(
    (state: RootState) => state.messages.allMessages
  );

  const scrollToBottom = () => {
    setTimeout(() => {
      if (messageContainerRef.current) {
        messageContainerRef.current.scrollIntoView({
          behavior: "smooth",
          block: "end",
          inline: "nearest",
        });
      }
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatId]);

  useEffect(() => {
    const getAllMessages = async () => {
      setLoader(true);
      if (chatId) {
        const messages = await getAllMessagesWithId(chatId);
        const { success, data } = messages;
        if (success) {
          dispatch(saveMessages(data));
        }
      }
      setLoader(false);
    };
    getAllMessages();
  }, [chatId]);

  const goBack = () => {
    navigate(-1);
  };

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const handleTypingFunc = (message: string) => {
      setTypingAlertText(message);
      setShowTyping(true);
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setShowTyping(false);
      }, 3000);
    };

    socket?.on("typing_notification", handleTypingFunc);

    return () => {
      socket?.off("typing_notification", handleTypingFunc);
      clearTimeout(timeoutId);
    };
  }, [socket]);

  useEffect(() => {
    if (showTyping) {
      // Scroll to the bottom when Niraj is typing
      messageContainerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "nearest",
      });
    }
  }, [showTyping]);

  const handleSendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (file) {
      const saveToServer = await sendFileToServer(file, (progress) => {
        setUploadProgress(progress);
      });
      const { success, url, mediaType } = saveToServer;
      if (success) {
        const data = {
          senderId: loggedInUser?._id,
          chatId: chatId,
          message: messageValue,
          media: url,
          mediaType: mediaType,
        };

        socket?.emit("send-individual-message", data);
      } else {
        alert("File uploading error");
      }

      setUploadProgress(0);
    } else {
      if (!messageValue) {
        return;
      }
      if (socket) {
        const data = {
          senderId: loggedInUser?._id,
          chatId: chatId,
          message: messageValue,
        };

        socket?.emit("send-individual-message", data);
      }
    }
    setFile(null);
    setMessageValue("");
    scrollToBottom();
  };

  const handleMessageInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const data = {
      message: `${loggedInUser?.fullName?.split(" ")[0]} is typing`,
      isTyping: true,
      receiver:
        loggedInUser._id ===
        chats.find((field) => field._id === chatId)?.adminUserDetails._id
          ? chats.find((field) => field._id === chatId)?.receiverUserDetails._id
          : chats.find((field) => field._id === chatId)?.adminUserDetails._id,
    };
    socket?.emit("typing", data);
    setMessageValue(e.target.value);
  };

  // Function to initiate audio call
  const handleAudioCall = async () => {
    try {
      // Get user's media devices (microphone)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Initialize peer connection
      const peerConnection = new RTCPeerConnection();

      // Add the user's media stream to the peer connection
      stream
        .getTracks()
        .forEach((track) => peerConnection.addTrack(track, stream));

      // Create an offer to start the call
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Send the offer to the other user through your signaling server
      // For simplicity, let's assume you have a socket connection
      socket?.emit("audio-call-offer", { offer });

      // Handle incoming answer from the other user
      socket?.on("audio-call-answer", async (data: any) => {
        const { answer } = data;
        await peerConnection.setRemoteDescription(answer);
      });

      // Handle ICE candidate events to establish connectivity
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          // Send ICE candidate to the other user through your signaling server
          socket?.emit("ice-candidate", { candidate: event.candidate });
        }
      };

      // Event listeners to handle incoming ICE candidates
      socket?.on("ice-candidate", (data: any) => {
        const { candidate } = data;
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      });

      // Event listener to handle closing the call
      socket?.on("close-audio-call", () => {
        peerConnection.close();
      });
    } catch (error) {
      console.error("Error initiating audio call:", error);
    }
  };

  return loader ? (
    <Spinner />
  ) : (
    <>
      <div className="single-message-container">
        <div className="single-message-container-header">
          <div className="back-sign">
            <BiArrowBack onClick={() => goBack()} />
            <div
              className="account-details"
              onClick={() => setShowProfile(!showProfile)}
            >
              <p>
                {chats?.find((field) => field._id === chatId)?.adminUserDetails
                  ?._id === loggedInUser?._id
                  ? chats?.find((field) => field._id === chatId)
                      ?.receiverUserDetails?.fullName
                  : chats?.find((field) => field._id === chatId)
                      ?.adminUserDetails?.fullName}
              </p>

              <p>Active: 1 hr ago</p>
            </div>
          </div>
          <div className="call-icons">
            <IoCall onClick={handleAudioCall} />
            <IoVideocam />
          </div>
        </div>
        {/* All Messages */}
        <div className="user-msg-cntainer">
          <div className="alert_msg">
            <p>
              Created this chat on{" "}
              {formatDateForInitialChatCreationAlert(
                chats?.find((field) => field._id === chatId)?.createdAt
              )}{" "}
            </p>
          </div>
          <div ref={messageContainerRef}>
            {/* Message Container */}
            {messages?.map((message) => {
              return (
                <div key={message?._id} className="users_conversation">
                  {loggedInUser._id === message.senderDetails?._id ? (
                    <MyMessagePart message={message} />
                  ) : (
                    <OtherPersonMessagePart message={message} />
                  )}
                </div>
              );
            })}
            {showTyping && (
              <div
                style={{ margin: "10px" }}
                className="user_conversation_container"
              >
                <div className="user_msg_container">
                  <div className="other_user_messages">
                    <p>{typingAlertText}...</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* Input Box */}
        <div className="selected-file">
          {file && (
            <div className="show-selected">
              <div
                className="progress-bar"
                style={{ width: `${uploadProgress}%` }}
              ></div>
              <p
                onClick={() => {
                  setFile(null);
                }}
              >
                X
              </p>
              {uploadProgress === 0 && (
                <>
                  {file.type.includes("image") ? (
                    <img src={URL?.createObjectURL(file)} alt="file" />
                  ) : (
                    <video controls src={URL.createObjectURL(file)} />
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {/* {isDragActive ? <p>Drop</p> : <p>Drag</p>} */}
        <form onSubmit={handleSendMessage}>
          <div className="input-box">
            <div
              className="file-icon"
              title="Drag or click an icon to select a file"
            >
              <div {...getRootProps()}>
                <label htmlFor="send-file">
                  <MdOutlineAttachFile color={file ? "red" : "white"} />
                </label>
                <input {...getInputProps()} />
              </div>
            </div>

            <div className="send-message-form">
              <div className="message-input">
                <input
                  value={messageValue}
                  onChange={handleMessageInputChange}
                  type="text"
                  placeholder={
                    isDragActive ? "Drop your file" : "Enter message"
                  }
                />
              </div>
              <div className="send-btn">
                <button>
                  <IoMdSend />
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
